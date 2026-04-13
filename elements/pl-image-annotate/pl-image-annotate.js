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
      this.$canvasContainer = this.element.find('.pl-image-annotate-canvas-container');

      if (this.files.length > 0) {
        this.$canvasContainer.show();
      } else {
        this.$canvasContainer.hide();
      }

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
            const isAllowed = this.acceptedFilesLowerCase.includes(fileExtension);

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
          if (this.$canvasContainer) this.$canvasContainer.show();

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
          <button type="button" class="btn btn-primary me-2 mb-2" data-type="${annotation.type}">
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
        label_position: annotation.label_position || 'top',
        label_bg_opacity: (annotation.label_bg_opacity ?? 0),
        label_auto_boundary: (annotation.label_auto_boundary ?? true),
        annotation_name: annotation.annotation_name,
        resizable: (annotation.resizable === 'true'),
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
          this.constrainAnnotationWithinCanvas(this.currentlyResizing);
          this.renderAnnotations();
          return;
        }

        if (this.dragging && this.currentlyDragging) {
          // Update annotation position
          this.currentlyDragging.x = pos.x - this.dragOffsetX;
          this.currentlyDragging.y = pos.y - this.dragOffsetY;

          // Constrain rectangle + label within the canvas.
          this.constrainAnnotationWithinCanvas(this.currentlyDragging);

          this.renderAnnotations();
        } else {
          // Change cursor style based on hover state
          const hoveredAnnotation = this.getAnnotationAtPos(pos);
          if (hoveredAnnotation) {
            const direction = this.getResizeDirection(hoveredAnnotation, pos);
            if (direction && hoveredAnnotation.resizable) {
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
      // Account for CSS scaling (e.g., max-width: 100%; height: auto).
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY,
      };
    }

    getAnnotationAtPos(pos) {
      // Iterate from top to bottom to select the topmost annotation
      for (let i = this.annotations.length - 1; i >= 0; i--) {
        const ann = this.annotations[i];

        const { minX, maxX, minY, maxY } = this.getAnnotationBounds(ann);

        if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
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

      // Ensure rectangle and label stay within canvas boundaries
      if (annotation.x < 0) {
        annotation.width += annotation.x;
        annotation.x = 0;
      }
      if (annotation.y < 0) {
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

              const labelLayout = this.getLabelLayout(ann);
              if (labelLayout) {
                // White backing so label is readable on any image.
                const prevFill = this.context.fillStyle;
                const opacityRaw = Number.isFinite(ann.label_bg_opacity) ? ann.label_bg_opacity : parseFloat(ann.label_bg_opacity);
                const opacity = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(1, opacityRaw)) : 0;
                this.context.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                this.context.fillRect(labelLayout.x, labelLayout.y, labelLayout.width, labelLayout.height);
                this.context.fillStyle = prevFill;

                const prevBaseline = this.context.textBaseline;
                this.context.textBaseline = 'top';
                labelLayout.lines.forEach((line, index) => {
                  this.context.fillText(line, labelLayout.textX, labelLayout.textY + index * ann.font_size);
                });
                this.context.textBaseline = prevBaseline;
              }
            }

            // Note: Resize handles are no longer drawn
          });
          this.saveCanvasAndAnnotations(); // Add this line to save after each render
        };
        if (this.files[0])
          img.src = this.files[0].contents;
      }
    }

    saveCanvasAndAnnotations() {
      if (this.files.length == 0) {
        this.element.find('input').val("");
        return;
      }
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

    getLabelLayout(annotation) {
      if (!annotation.label) return null;

      // Keep rendering and hit-testing consistent.
      const lines = annotation.label.split(/&#10;|&#xA;|\n/);
      this.context.font = `${annotation.font_size}px Arial`;

      const textWidth = lines.reduce((maxWidth, line) => {
        const lineWidth = this.context.measureText(line).width;
        return Math.max(maxWidth, lineWidth);
      }, 0);

      const textHeight = lines.length * annotation.font_size;
      const padX = 6;
      const padY = 4;
      const width = textWidth + padX * 2;
      const height = textHeight + padY * 2;
      const pad = 8;

      const requested = (annotation.label_position || 'top').toString().trim().toLowerCase();
      const valid = new Set(['top', 'bottom', 'left', 'right']);
      const position = valid.has(requested) ? requested : 'right';

      const autoBoundary = this.isLabelAutoBoundaryEnabled(annotation);

      const centerX = annotation.x + (annotation.width - width) / 2;
      const centerY = annotation.y + (annotation.height - height) / 2;

      const placementFor = (pos) => {
        switch (pos) {
          case 'left':
            return { x: annotation.x - width - pad, y: centerY };
          case 'right':
            return { x: annotation.x + annotation.width + pad, y: centerY };
          case 'top':
            return { x: centerX, y: annotation.y - height - pad };
          case 'bottom':
            return { x: centerX, y: annotation.y + annotation.height + pad };
          default:
            return { x: annotation.x + annotation.width + pad, y: centerY };
        }
      };

      const opposite = (pos) => {
        switch (pos) {
          case 'left':
            return 'right';
          case 'right':
            return 'left';
          case 'top':
            return 'bottom';
          case 'bottom':
            return 'top';
          default:
            return 'left';
        }
      };

      let { x, y } = placementFor(position);

      if (autoBoundary) {
        // If the requested position would push the label off-canvas, try the opposite side.
        const offscreen = (xx, yy) => (
          xx < 0 ||
          yy < 0 ||
          xx + width > this.canvas.width ||
          yy + height > this.canvas.height
        );

        if (offscreen(x, y)) {
          ({ x, y } = placementFor(opposite(position)));
        }

        // Clamp within canvas as a last resort.
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x + width > this.canvas.width) x = Math.max(0, this.canvas.width - width);
        if (y + height > this.canvas.height) y = Math.max(0, this.canvas.height - height);
      }

      return { lines, x, y, width, height, textX: x + padX, textY: y + padY };
    }

    isLabelAutoBoundaryEnabled(annotation) {
      const v = annotation.label_auto_boundary;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
      }
      return false;
    }

    getAnnotationBounds(annotation) {
      const labelLayout = this.getLabelLayout(annotation);

      const rectHitPad = Math.max(2, Math.ceil((annotation.border_width || 0) / 2));
      let minX = annotation.x - rectHitPad;
      let maxX = annotation.x + annotation.width + rectHitPad;
      let minY = annotation.y - rectHitPad;
      let maxY = annotation.y + annotation.height + rectHitPad;

      if (labelLayout) {
        minX = Math.min(minX, labelLayout.x);
        maxX = Math.max(maxX, labelLayout.x + labelLayout.width);
        minY = Math.min(minY, labelLayout.y);
        maxY = Math.max(maxY, labelLayout.y + labelLayout.height);
      }

      return { minX, maxX, minY, maxY };
    }

    getRectBounds(annotation) {
      const rectHitPad = Math.max(2, Math.ceil((annotation.border_width || 0) / 2));
      return {
        minX: annotation.x - rectHitPad,
        maxX: annotation.x + annotation.width + rectHitPad,
        minY: annotation.y - rectHitPad,
        maxY: annotation.y + annotation.height + rectHitPad,
      };
    }

    constrainAnnotationWithinCanvas(annotation) {
      // One adjustment can flip label right<->left; do two passes for stability.
      for (let pass = 0; pass < 2; pass++) {
        const bounds = this.isLabelAutoBoundaryEnabled(annotation)
          ? this.getAnnotationBounds(annotation)
          : this.getRectBounds(annotation);
        let dx = 0;
        let dy = 0;

        if (bounds.minX < 0) dx = -bounds.minX;
        else if (bounds.maxX > this.canvas.width) dx = this.canvas.width - bounds.maxX;

        if (bounds.minY < 0) dy = -bounds.minY;
        else if (bounds.maxY > this.canvas.height) dy = this.canvas.height - bounds.maxY;

        if (dx === 0 && dy === 0) break;
        annotation.x += dx;
        annotation.y += dy;
      }
    }
  }

  window.PLImageAnnotate  = PLImageAnnotate ;
})();
