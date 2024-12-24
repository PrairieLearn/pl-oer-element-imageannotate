/* eslint-env browser, jquery */

(() => {
  class PLImageAnnotate {
    constructor(uuid, options) {
      this.uuid = uuid;
      this.files = [];
      this.acceptedFiles = options.acceptedFiles || []; // ['.jpg', '.jpeg', '.png', '.gif']
      this.acceptedFilesLowerCase = this.acceptedFiles.map(f => f.toLowerCase());
      this.selectableColors = options.selectableColors || [
        { name: 'Black', hex: '#000000' },
        { name: 'Red', hex: '#FF0000' },
        { name: 'Blue', hex: '#0000FF' },
        { name: 'Green', hex: '#00FF00' },
        { name: 'Orange', hex: '#FFA500' },
        { name: 'Purple', hex: '#800080' },
        { name: 'Yellow', hex: '#FFFF00' },
        { name: 'Pink', hex: '#FFC0CB' },
        { name: 'Gray', hex: '#808080' },
        // Add more colors as needed
      ];
      this.rectangleConfigs = Array.isArray(options.rectangleAnnotations.config) 
        ? options.rectangleAnnotations.config 
        : options.rectangleAnnotations || [];
      this.canvasWidth = parseInt(options.width, 10) || 500;
      this.canvasHeight = parseInt(options.height, 10) || 100;
      console.log(`Canvas Width Option Received: ${this.canvasWidth}px`);

      const elementId = '#file-upload-' + uuid;
      this.element = $(elementId);
      if (!this.element.length) {
        throw new Error('File upload element ' + elementId + ' was not found!');
      }

      this.canvas = document.getElementById(`annotate-canvas-${uuid}`);
      this.context = this.canvas.getContext('2d');
      this.annotations = []; // Store current annotation data

      // Variables for dragging and resizing
      this.dragging = false;
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      this.currentlyDragging = null;
      this.resizing = false;
      this.currentlyResizing = null;
      this.resizeDirection = null;

      // Initialize annotations from saved state if available
      if (options.rectangleAnnotations && options.rectangleAnnotations.savedState) {
        this.files = options.rectangleAnnotations.savedState.files || [];
        this.annotations = options.rectangleAnnotations.savedState.annotations || [];
        if (this.files.length > 0) {
          const img = new Image();
          img.onload = () => {
            this.canvas.height = (img.height / img.width) * this.canvasWidth;
            this.renderAnnotations();
            this.saveCanvasAndAnnotations(); // Add this line to save initial state
          };
          img.src = this.files[0].contents;
        }
      } else {
        this.files = [];
        this.annotations = [];
      }

      this.initializeTemplate();
    }

    initializeTemplate() {
      const $dropTarget = this.element.find('.upload-dropzone');

      // Initialize Dropzone with previews disabled
      $dropTarget.dropzone({
        url: '/none',
        autoProcessQueue: false,
        acceptedFiles: this.acceptedFiles.join(','), // e.g., ".jpg,.jpeg,.png,.gif"
        addRemoveLinks: false, // Disable add/remove links
        previewsContainer: false, // Disable previews
        createImageThumbnails: false, // Further ensure no thumbnails
        thumbnailWidth: 0,           // Set thumbnail width to 0
        dictDefaultMessage: 'Drop image files here or click to upload.',
        init: () => {
          this.dropzone = $dropTarget[0].dropzone;
          this.dropzone.on('addedfile', (file) => {
            const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
            console.log('Uploaded file extension:', fileExtension);
            const isAllowed = this.acceptedFilesLowerCase.includes(fileExtension);
            console.log('Is allowed:', isAllowed);

            if (!isAllowed) {
              this.addWarningMessage(
                '<strong>' + file.name + '</strong>' + ' is not a supported image type.'
              );
              this.dropzone.removeFile(file);
              return;
            }

            this.addFileFromBlob(file.name, file, false);
          });
        },
      });

      // Set canvas dimensions
      this.canvas.width = this.canvasWidth;
      this.canvas.height = this.canvasHeight;

      // Render Rectangle Annotation Buttons
      this.renderRectangleAnnotationButtons();

      // Setup annotation events
      this.setupCanvasEvents();
    }

    addFileFromBlob(name, blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Adjust canvas size based on image
          this.canvas.width = this.canvasWidth;
          this.canvas.height = (img.height / img.width) * this.canvasWidth;

          // Draw the image onto the canvas
          this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.context.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);

          // Save the uploaded image
          this.files = [{ name, contents: e.target.result }];
          
          // Reset annotations
          this.annotations = [];
          
          this.renderAnnotations(); // Render existing annotations after image load
          this.saveCanvasAndAnnotations(); // Save canvas and annotations
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(blob);
    }

    renderRectangleAnnotationButtons() {
      const $buttonsContainer = this.element.find('.rectangle-annotations');
      $buttonsContainer.empty(); // Clear existing buttons

      // Use rectangleConfigs instead of rectangleAnnotations
      this.rectangleConfigs.forEach((annotation) => {
        const labelWithLineBreaks = annotation.label.replace(/&#10;|&#xA;|\n/g, '<br>');
        const $btn = $(`
          <button type="button" class="btn btn-primary mr-2 mb-2" data-type="${annotation.type}">
            ${labelWithLineBreaks}
          </button>
        `);

        // Attach click event to activate drawing mode
        $btn.on('click', () => {
          this.activateDrawingMode(annotation);
        });

        $buttonsContainer.append($btn);
      });
    }

    activateDrawingMode(annotation) {
      // Check if an annotation of this type already exists
      const existing = this.annotations.find(ann => ann.type === annotation.type);
      if (existing) {
        // Delete the existing annotation
        this.annotations = this.annotations.filter(ann => ann.type !== annotation.type);
        this.renderAnnotations();
        this.saveCanvasAndAnnotations();
        return; // Exit the function without creating a new annotation
      }

      // Create new annotation
      const rectWidth = parseInt(annotation.width, 10) || 100;
      const rectHeight = parseInt(annotation.height, 10) || 100;
      const centerX = (this.canvas.width - rectWidth) / 2;
      const centerY = (this.canvas.height - rectHeight) / 2;

      const newAnnotation = {
        type: annotation.type,
        x: centerX,
        y: centerY,
        width: rectWidth,
        height: rectHeight,
        color: this.getColorFromAttribute(annotation.color),
        label: annotation.label,
        annotation_name: annotation.annotation_name,
        font_size: parseInt(annotation.font_size, 10) || 14,
        border_width: parseInt(annotation.border_width, 10) || 2,
      };

      this.annotations.push(newAnnotation);
      this.renderAnnotations();
      this.saveCanvasAndAnnotations();
    }

    getColorFromAttribute(colorAttr) {
      // Check if the colorAttr is a valid hex code
      const isHex = /^#([0-9A-F]{3}){1,2}$/i.test(colorAttr);
      if (isHex) {
        return colorAttr;
      }

      // Otherwise, check if it's a predefined color name
      const colorObj = this.selectableColors.find(c => c.name.toLowerCase() === colorAttr.toLowerCase());
      if (colorObj) {
        return colorObj.hex;
      }

      // Default color if not found
      return '#FF0000'; // Red
    }

    setupCanvasEvents() {
      // Mouse down event
      this.canvas.addEventListener('mousedown', (e) => {
        const pos = this.getMousePos(e);
        const clickedAnnotation = this.getAnnotationAtPos(pos);

        if (clickedAnnotation) {
          // Check if the click is near an edge for resizing
          const direction = this.getResizeDirection(clickedAnnotation, pos);
          if (direction && clickedAnnotation.resizable) {
            this.resizing = true;
            this.currentlyResizing = clickedAnnotation;
            this.resizeDirection = direction;
            return;
          }

          // Initiate dragging
          this.dragging = true;
          this.currentlyDragging = clickedAnnotation;
          this.dragOffsetX = pos.x - clickedAnnotation.x;
          this.dragOffsetY = pos.y - clickedAnnotation.y;
          this.renderAnnotations();
        }
      });

      // Mouse move event
      this.canvas.addEventListener('mousemove', (e) => {
        const pos = this.getMousePos(e);

        if (this.resizing && this.currentlyResizing) {
          this.resizeAnnotation(this.currentlyResizing, pos);
          this.renderAnnotations();
          return;
        }

        if (this.dragging && this.currentlyDragging) {
          // Update annotation position
          this.currentlyDragging.x = pos.x - this.dragOffsetX;
          this.currentlyDragging.y = pos.y - this.dragOffsetY;

          // Constrain the rectangle within canvas boundaries including label
          if (this.currentlyDragging.x < 0)
            this.currentlyDragging.x = 0;
          if (this.currentlyDragging.y < 0)
            this.currentlyDragging.y = 0;
          if (this.currentlyDragging.x + this.currentlyDragging.width > this.canvas.width)
            this.currentlyDragging.x = this.canvas.width - this.currentlyDragging.width;
          if (this.currentlyDragging.y + this.currentlyDragging.height > this.canvas.height)
            this.currentlyDragging.y = this.canvas.height - this.currentlyDragging.height;

          this.renderAnnotations();
        } else {
          // Change cursor style based on hover state
          const hoveredAnnotation = this.getAnnotationAtPos(pos);
          if (hoveredAnnotation) {
            const direction = this.getResizeDirection(hoveredAnnotation, pos);
            if (direction) {
              this.canvas.style.cursor = this.getCursorForDirection(direction);
            } else {
              this.canvas.style.cursor = 'move';
            }
          } else {
            this.canvas.style.cursor = 'default';
          }
        }
      });

      // Mouse up event
      this.canvas.addEventListener('mouseup', (e) => {
        this.resetInteractionStates();
      });

      // Mouse leave event to treat as mouse release
      this.canvas.addEventListener('mouseleave', () => {
        this.resetInteractionStates();
      });

      // Prevent default drag behavior
      this.canvas.addEventListener('dragstart', (e) => {
        e.preventDefault();
      });
    }

    resetInteractionStates() {
      if (this.dragging) {
        this.dragging = false;
        this.currentlyDragging = null;
        this.saveCanvasAndAnnotations(); // Save canvas and annotations
      }
      if (this.resizing) {
        this.resizing = false;
        this.currentlyResizing = null;
        this.resizeDirection = null;
        this.saveCanvasAndAnnotations(); // Save canvas and annotations
      }
    }

    getMousePos(evt) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
      };
    }

    getAnnotationAtPos(pos) {
      // Iterate from top to bottom to select the topmost annotation
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const ann = this.annotations[i];

        // Calculate label dimensions
        const lines = ann.label ? ann.label.split(/&#10;|&#xA;|\n/) : [];
        this.context.font = `${ann.font_size}px Arial`;
        const labelWidth = lines.reduce((maxWidth, line) => {
          const lineWidth = this.context.measureText(line).width;
          return Math.max(maxWidth, lineWidth);
        }, 0);
        const labelHeight = lines.length * ann.font_size + 10; 
        const drawAbove = ann.y - 10 - labelHeight >= 0;

        // Determine label position
        let labelX = ann.x;
        let labelY = drawAbove ? ann.y - labelHeight - 10 : ann.y + ann.height + 10;

        // Create a combined bounding box for the rectangle and label
        let minX = Math.min(ann.x, labelX);
        let maxX = Math.max(ann.x + ann.width, labelX + labelWidth);
        let minY = Math.min(ann.y, labelY);
        let maxY = Math.max(ann.y + ann.height, labelY + labelHeight);

        // Expand clickable area for small rectangles
        const buffer = 1; // Pixels to expand the clickable area
        const minSize = 10; // Threshold for small rectangles

        if (ann.width < minSize || ann.height < minSize) {
          minX -= buffer;
          maxX += buffer;
          minY -= buffer;
          maxY += buffer;
        }

        if (
          pos.x >= minX &&
          pos.x <= maxX &&
          pos.y >= minY &&
          pos.y <= maxY
        ) {
          return ann;
        }
      }
      return null;
    }

    getResizeDirection(annotation, pos) {
      // Increase edgeThreshold for small rectangles
      let edgeThreshold = 10;
      const minSize = 20;
      if (annotation.width < minSize || annotation.height < minSize) {
        edgeThreshold = 15; // Increase threshold for small rectangles
      }

      const { x, y, width, height } = annotation;

      let direction = null;

      // Check corners
      if (this.isWithin(pos, x - edgeThreshold, y - edgeThreshold, edgeThreshold * 2, edgeThreshold * 2)) {
        direction = 'nw';
      } else if (this.isWithin(pos, x + width - edgeThreshold, y - edgeThreshold, edgeThreshold * 2, edgeThreshold * 2)) {
        direction = 'ne';
      } else if (this.isWithin(pos, x - edgeThreshold, y + height - edgeThreshold, edgeThreshold * 2, edgeThreshold * 2)) {
        direction = 'sw';
      } else if (this.isWithin(pos, x + width - edgeThreshold, y + height - edgeThreshold, edgeThreshold * 2, edgeThreshold * 2)) {
        direction = 'se';
      }
      // Check edges
      else if (Math.abs(pos.y - y) <= edgeThreshold && pos.x > x + edgeThreshold && pos.x < x + width - edgeThreshold) {
        direction = 'n';
      } else if (Math.abs(pos.y - (y + height)) <= edgeThreshold && pos.x > x + edgeThreshold && pos.x < x + width - edgeThreshold) {
        direction = 's';
      } else if (Math.abs(pos.x - x) <= edgeThreshold && pos.y > y + edgeThreshold && pos.y < y + height - edgeThreshold) {
        direction = 'w';
      } else if (Math.abs(pos.x - (x + width)) <= edgeThreshold && pos.y > y + edgeThreshold && pos.y < y + height - edgeThreshold) {
        direction = 'e';
      }

      return direction;
    }

    isWithin(pos, x, y, width, height) {
      return (
        pos.x >= x &&
        pos.x <= x + width &&
        pos.y >= y &&
        pos.y <= y + height
      );
    }

    getCursorForDirection(direction) {
      const cursors = {
        'nw': 'nwse-resize',
        'n': 'ns-resize',
        'ne': 'nesw-resize',
        'e': 'ew-resize',
        'se': 'nwse-resize',
        's': 'ns-resize',
        'sw': 'nesw-resize',
        'w': 'ew-resize',
      };
      return cursors[direction] || 'default';
    }

    resizeAnnotation(annotation, pos) {
      const original = { ...annotation };
      const minSize = 5; // Minimum size of rectangle

      switch (this.resizeDirection) {
        case 'nw':
          annotation.width += annotation.x - pos.x;
          annotation.height += annotation.y - pos.y;
          annotation.x = pos.x;
          annotation.y = pos.y;
          break;
        case 'n':
          annotation.height += annotation.y - pos.y;
          annotation.y = pos.y;
          break;
        case 'ne':
          annotation.width = pos.x - annotation.x;
          annotation.height += annotation.y - pos.y;
          annotation.y = pos.y;
          break;
        case 'e':
          annotation.width = pos.x - annotation.x;
          break;
        case 'se':
          annotation.width = pos.x - annotation.x;
          annotation.height = pos.y - annotation.y;
          break;
        case 's':
          annotation.height = pos.y - annotation.y;
          break;
        case 'sw':
          annotation.width += annotation.x - pos.x;
          annotation.height = pos.y - annotation.y;
          annotation.x = pos.x;
          break;
        case 'w':
          annotation.width += annotation.x - pos.x;
          annotation.x = pos.x;
          break;
        default:
          break;
      }

      // Calculate label height
      const labelLines = annotation.label ? annotation.label.split(/&#10;|&#xA;|\n/).length : 0;
      const labelHeight = labelLines * annotation.font_size + 10; // 10 for padding

      // Ensure rectangle and label stay within canvas boundaries
      if (annotation.x < 0) {
        annotation.width += annotation.x;
        annotation.x = 0;
      }
      if (annotation.y < 0) {
        annotation.height += annotation.y - labelHeight;
        annotation.y = 0;
      }
      if (annotation.x + annotation.width > this.canvas.width) {
        annotation.width = this.canvas.width - annotation.x;
      }
      if (annotation.y + annotation.height > this.canvas.height) {
        annotation.height = this.canvas.height - annotation.y;
      }

      // Enforce minimum size
      if (annotation.width < minSize) {
        annotation.width = minSize;
        annotation.x = original.x;
      }
      if (annotation.height < minSize) {
        annotation.height = minSize;
        annotation.y = original.y;
      }
    }

    renderAnnotations() {
      // Clear canvas and redraw image
      if (this.files.length > 0) {
        const img = new Image();
        img.onload = () => {
          this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.context.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
          // Draw all annotations
          this.annotations.forEach(ann => {
            // Draw rectangle border
            this.context.strokeStyle = ann.color;
            this.context.lineWidth = ann.border_width;
            this.context.strokeRect(ann.x, ann.y, ann.width, ann.height);

            // Draw label
            if (ann.label) {
              this.context.fillStyle = ann.color;
              this.context.font = `${ann.font_size}px Arial`;
              
              // Split the label by newline characters
              const lines = ann.label.split(/&#10;|&#xA;|\n/);
              
              // Calculate total label height
              const totalLabelHeight = lines.length * ann.font_size + 10; // 10 for padding

              // Determine if there's enough space above the rectangle
              let labelYPosition = ann.y - 10;
              let drawAbove = true;

              if (labelYPosition - totalLabelHeight < 0) {
                // Not enough space above; draw label below the rectangle
                labelYPosition = ann.y + ann.height + 10;
                drawAbove = false;
              }

              // Draw each line separately at the computed position
              lines.forEach((line, index) => {
                if (drawAbove) {
                  this.context.fillText(line, ann.x, labelYPosition - ((lines.length - 1 - index) * ann.font_size));
                } else {
                  this.context.fillText(line, ann.x, labelYPosition + (index + 0.6) * ann.font_size);
                }
              });
            }

            // Note: Resize handles are no longer drawn
          });
          this.saveCanvasAndAnnotations(); // Add this line to save after each render
        };
        img.src = this.files[0].contents;
      }
    }

    saveCanvasAndAnnotations() {
      const canvasData = this.canvas.toDataURL();
      const annotationData = this.annotations.reduce((acc, annotation) => {
        acc[annotation.annotation_name] = this.getAnnotationContent(annotation);
        return acc;
    }, {});    

      const output = {
        canvas: canvasData,
        savedState: {
          files: this.files,
          annotations: this.annotations
        },
        rectangles: annotationData
      };

      this.element.find('input').val(JSON.stringify(output));
    }

    getAnnotationContent(annotation) {
      const annotationCanvas = document.createElement('canvas');
      annotationCanvas.width = annotation.width;
      annotationCanvas.height = annotation.height;
      const annotationContext = annotationCanvas.getContext('2d');
      const border = annotation.border_width;
      const borderOffset = Math.ceil(border / 2) - Math.floor(border / 2);

      // Create a temporary canvas to draw the image without annotations
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempContext = tempCanvas.getContext('2d');

      // Draw the image onto the temporary canvas
      const img = new Image();
      img.src = this.files[0].contents;
      tempContext.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);

      // Draw the annotation onto the annotation canvas
      annotationContext.drawImage(
        tempCanvas,
        annotation.x + Math.ceil(border / 2), annotation.y + Math.ceil(border / 2), annotation.width - border, annotation.height - border,
        0, 0, annotation.width, annotation.height
      );
      return annotationCanvas.toDataURL();
    }
  }

  window.PLImageAnnotate  = PLImageAnnotate ;
})();