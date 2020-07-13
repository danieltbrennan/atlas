import { ColdSubscription, easing, inertia, listen, pointer, tween, value } from 'popmotion';
import { clamp } from '@popmotion/popcorn';
import { Projection, scaleAtOrigin, transform } from '@atlas-viewer/dna';
import { RuntimeController, Position } from '../../types';

export type PopmotionControllerConfig = {
  zoomOut?: HTMLElement | null;
  zoomIn?: HTMLElement | null;
  reset?: HTMLElement | null;
  printX?: HTMLElement | null;
  printY?: HTMLElement | null;
  zoomOutFactor?: number;
  zoomInFactor?: number;
  maxZoomFactor?: number;
  minZoomFactor?: number;
  zoomDuration?: number;
  zoomClamp?: number;
  zoomWheelConstant?: number;
  panBounceStiffness?: number;
  panBounceDamping?: number;
  panTimeConstant?: number;
  panPower?: number;
  nudgeDistance?: number;
  panPadding?: number;
  devicePixelRatio?: number;
  enableWheel?: boolean;
  enableClickToZoom?: boolean;
};

export const defaultConfig: Required<PopmotionControllerConfig> = {
  // Optional HTML Elements
  zoomOut: null,
  zoomIn: null,
  printX: null,
  reset: null,
  printY: null,
  // Zoom options
  zoomOutFactor: 0.8,
  zoomInFactor: 1.25,
  maxZoomFactor: 1,
  minZoomFactor: 0.05,
  zoomDuration: 300,
  zoomWheelConstant: 100,
  zoomClamp: 0.6,
  // Pan options.
  panBounceStiffness: 120,
  panBounceDamping: 15,
  panTimeConstant: 240,
  panPower: 0.1,
  nudgeDistance: 100,
  panPadding: 0,
  devicePixelRatio: 1,
  // Flags
  enableWheel: true,
  enableClickToZoom: true,
};

export const popmotionController = (canvas: HTMLElement, config: PopmotionControllerConfig = {}): RuntimeController => {
  const state: any = {
    viewer: undefined,
  };

  return {
    updatePosition(x, y, width, height) {
      if (state.viewer) {
        state.viewer.update({ x, y, width, height });
      }
    },
    start: function(runtime) {
      const {
        zoomOut,
        zoomIn,
        zoomOutFactor,
        zoomInFactor,
        zoomDuration,
        zoomWheelConstant,
        zoomClamp,
        printX,
        printY,
        reset,
        minZoomFactor,
        panBounceStiffness,
        panBounceDamping,
        panTimeConstant,
        panPower,
        nudgeDistance,
        panPadding,
        enableWheel,
        enableClickToZoom,
        devicePixelRatio,
      } = {
        ...defaultConfig,
        ...config,
      };

      // Need this anyway to be in scope.
      let click = false;
      const canvasPos = canvas.getBoundingClientRect();

      // Some user interactions, using popmotion. This is an observer, listening
      //  to the x, y, height and width co-ordinates and updating the views.
      // This acts as a bridge to popmotion, allowing us to twean these values as
      // we see fit.
      const viewer = value(
        {
          x: runtime.target[1],
          y: runtime.target[2],
          width: runtime.target[3] - runtime.target[1],
          height: runtime.target[4] - runtime.target[2],
        } as Projection,
        // This takes in a {x, y, width, height} and updates the viewport.
        runtime.setViewport
      );

      state.viewer = viewer;

      // These two control the dragging, panning and zooming. The second has inertia
      // so it will slow down and bounce on the sides.
      listen(canvas, 'mousedown touchstart').start((e: { touches: [] }) => {
        if (runtime.mode === 'explore') {
          const { x, y } = viewer.get() as Position;
          pointer({
            x: (-x * runtime.scaleFactor) / devicePixelRatio,
            y: (-y * runtime.scaleFactor) / devicePixelRatio,
          })
            .pipe((v: Position): Position => ({ x: v.x * devicePixelRatio, y: v.y * devicePixelRatio }))
            .pipe((v: Position): Position => ({ x: -v.x / runtime.scaleFactor, y: -v.y / runtime.scaleFactor }))
            .start(viewer);
        }
      });

      const constrainBounds = (immediate = false) => {
        const { x1, x2, y1, y2 } = runtime.getBounds(panPadding);

        if (immediate) {
          viewer.stop();
          viewer.update({
            x: x1,
            y: y1,
          });
          return;
        }

        inertia({
          min: { x: x1, y: y1 },
          max: { x: x2, y: y2 },
          bounceStiffness: panBounceStiffness,
          bounceDamping: panBounceDamping,
          timeConstant: immediate ? 0 : panTimeConstant,
          power: panPower,
          restDelta: 0,
          from: viewer.get(),
          velocity: viewer.getVelocity(),
        }).start(viewer);
      };

      runtime.world.addLayoutSubscriber(type => {
        if (type === 'zone-changed') {
          // @TODO this needs to be "goHome" equivalent
          constrainBounds(true);
        }
      });

      if (reset) {
        reset.addEventListener('click', () => {
          // const bounds = runtime.getBounds(panPadding);
          // viewer.update({
          //   x: bounds.x1,
          //   y: bounds.x2,
          // });

          constrainBounds();
        });
      }

      // runtime.registerEventListener('click', dispatch => {
      //   const listener = (e: MouseEvent) =>
      //     dispatch(
      //       runtime.viewerToWorld(
      //         e.pageX * devicePixelRatio - canvasPos.left,
      //         e.pageY * devicePixelRatio - canvasPos.top
      //       )
      //     );
      //   canvas.addEventListener('click', listener);
      //
      //   return () => {
      //     canvas.removeEventListener('click', listener);
      //   };
      // });

      listen(canvas, 'mouseup touchend').start(() => {
        constrainBounds();
      });

      // A generic zoom to function, with an optional origin parameter.
      // All of the points referenced are world points. You can pass your
      // own in or it will simply default to the middle of the viewport.
      // Note: the factor changes the size of the VIEWPORT on the canvas.
      // So smaller values will zoom in, and larger values will zoom out.
      let currentZoom: ColdSubscription | undefined;

      function zoomTo(factor: number, origin?: Position, stream = false) {
        if (runtime.scaleFactor / factor > 1 / minZoomFactor) {
          factor = runtime.scaleFactor / (1 / minZoomFactor);
        }
        if (factor >= 1 && runtime.scaleFactor / factor < 1 / runtime.maxScaleFactor) {
          factor = runtime.scaleFactor / (1 / runtime.maxScaleFactor);
        }

        // Save the before for the tween.
        const fromPos = runtime.getViewport();
        // set the new scale.
        const newPoints = transform(
          runtime.target,
          scaleAtOrigin(
            factor,
            origin ? origin.x : runtime.target[1] + (runtime.target[3] - runtime.target[1]) / 2,
            origin ? origin.y : runtime.target[2] + (runtime.target[4] - runtime.target[2]) / 2
          )
        );
        // Need to update our observables, for pop-motion
        if (currentZoom) {
          currentZoom.stop();
        }

        currentZoom = tween({
          from: fromPos,
          to: Object.create({
            x: newPoints[1],
            y: newPoints[2],
            width: newPoints[3] - newPoints[1],
            height: newPoints[4] - newPoints[2],
          }),
          duration: zoomDuration,
          ease: stream ? easing.easeOut : easing.easeInOut,
        }).start(viewer);
      }

      // Let's use that new zoom method, first we will hook up the UI buttons to zoom.
      // Simple zoom out control.
      if (zoomOut) {
        zoomOut.addEventListener('click', () => zoomTo(1 / zoomOutFactor));
      }
      if (zoomIn) {
        // Simple zoom in control.
        zoomIn.addEventListener('click', () => zoomTo(1 / zoomInFactor));
      }

      let isPressing = false;

      canvas.addEventListener('touchstart', e => {
        if (runtime.mode === 'explore') {
          isPressing = true;
        }
      });

      window.addEventListener('touchend', e => {
        if (isPressing) {
          constrainBounds();
          isPressing = false;
        }
      });

      canvas.addEventListener('mousedown', e => {
        isPressing = true;
      });

      window.addEventListener('mouseup', e => {
        if (isPressing) {
          if (runtime.mode === 'explore') {
            constrainBounds();
          }
          isPressing = false;
        }
      });

      document.addEventListener('keydown', e => {
        switch (e.code) {
          case 'ArrowLeft':
            tween({
              from: { x: runtime.x, y: runtime.y },
              to: { x: runtime.x - nudgeDistance / runtime.scaleFactor, y: runtime.y },
              duration: zoomDuration,
            }).start(viewer);
            break;
          case 'ArrowRight':
            tween({
              from: { x: runtime.x, y: runtime.y },
              to: { x: runtime.x + nudgeDistance / runtime.scaleFactor, y: runtime.y },
              duration: zoomDuration,
            }).start(viewer);
            break;
          case 'ArrowUp':
            tween({
              from: { x: runtime.x, y: runtime.y },
              to: { x: runtime.x, y: runtime.y - nudgeDistance / runtime.scaleFactor },
              duration: zoomDuration,
            }).start(viewer);
            break;
          case 'ArrowDown':
            tween({
              from: { x: runtime.x, y: runtime.y },
              to: { x: runtime.x, y: runtime.y + nudgeDistance / runtime.scaleFactor },
              duration: zoomDuration,
            }).start(viewer);
            break;
        }
      });

      if (enableWheel) {
        // Next we will add a scrolling event to the scroll-wheel.
        canvas.addEventListener('wheel', e => {
          if (runtime.mode === 'explore') {
            e.preventDefault();
            const zoomFactor = 1 + (e.deltaY * devicePixelRatio) / zoomWheelConstant;
            zoomTo(
              // Generating a zoom from the wheel delta
              clamp(1 - zoomClamp, 1 + zoomClamp, zoomFactor),
              // Convert the cursor to an origin
              runtime.viewerToWorld(
                e.pageX * devicePixelRatio - canvasPos.left,
                e.pageY * devicePixelRatio - canvasPos.top
              ),
              true
            );
          }
        });
      }

      // The following lines are incomplete implementations of multi-touch zoom. This currently
      // interferes with the panning and would need to be combined for touch inputs.

      // const middlePoint = (points: Array<{ x: number; y: number }>) => {
      //   if (points.length > 0) {
      //     let xAcc = 0;
      //     let yAcc = 0;
      //
      //     for (let i = 0; i < points.length; i++) {
      //       xAcc += points[i].x;
      //       yAcc += points[i].y;
      //     }
      //     return {
      //       x: xAcc / points.length,
      //       y: yAcc / points.length,
      //     };
      //   }
      //   return {
      //     x: 0,
      //     y: 0,
      //   };
      // };

      // let moveSub: ColdSubscription | undefined;
      // listen(canvas, 'touchstart').start((er) => {
      //   er.preventDefault();
      //   moveSub = multitouch({ scale: runtime.scaleFactor, preventDefault: true }).start(
      //     (e: { touches: Array<{ x: number; y: number }>; scale: number }) => {
      //       if (e.touches.length !== 2) {
      //         return;
      //       }
      //       const { x, y } = middlePoint(e.touches);
      //
      //       const scaleF = (1 / e.scale) * runtime.scaleFactor;
      //       const origin =
      //         // Convert the cursor to an origin
      //         runtime.viewerToWorld(x - canvasPos.left, y - canvasPos.top);
      //
      //       if (zoomIn) {
      //         zoomIn.innerText = `${origin.x}, ${origin.y}`;
      //       }
      //
      //       // Save the before for the tween.
      //       // const fromPos = runtime.getViewport();
      //       // set the new scale.
      //       const newPoints = transform(
      //         runtime.target,
      //         scaleAtOrigin(
      //           scaleF,
      //           origin && origin.x > 0 ? origin.x : runtime.target[1] + (runtime.target[3] - runtime.target[1]) / 2,
      //           origin && origin.y > 0 ? origin.y : runtime.target[2] + (runtime.target[4] - runtime.target[2]) / 2
      //         )
      //       );
      //
      //       viewer.update({
      //         x: newPoints[1],
      //         y: newPoints[2],
      //         width: newPoints[3] - newPoints[1],
      //         height: newPoints[4] - newPoints[2],
      //       });
      //     }
      //   );
      // });
      //
      // listen(document, 'mouseup touchend').start(() => {
      //   if (moveSub) {
      //     moveSub.stop();
      //   }
      // });

      // // let delta = 0;
      // let kasd = 0;
      // multitouch({ scale: runtime.scaleFactor }).start(e => {
      //   if (e.touches.length === 2) {
      //     kasd++;
      //
      //     if (zoomIn) {
      //       zoomIn.innerText = `${e.scale}`;
      //       zoomIn.style.fontSize = `11px`;
      //     }
      //     if (zoomOut) {
      //       zoomOut.innerText = `${kasd}`;
      //     }
      //     // const {x, y} = middlePoint(e.touches);
      //     // const zoomFactor = (e.scale - delta) / runtime.scaleFactor;
      //     // delta = e.scale;
      //     //
      //     // // const zoomFactor = 1 / e.scale;
      //     // // const clamped =
      //     // //   zoomFactor < 1 - zoomClamp ? 1 - zoomClamp : zoomFactor > 1 + zoomClamp ? 1 + zoomClamp : zoomFactor;
      //     // zoomTo(
      //     //   // Generating a zoom from the wheel delta
      //     //   zoomFactor,
      //     //   // Convert the cursor to an origin
      //     //   runtime.viewerToWorld(x - canvasPos.left, y - canvasPos.top),
      //     //   true
      //     // );
      //   }
      // });

      if (enableClickToZoom) {
        // For clicking its a little trickier. We want to still allow panning. So this
        // little temporary variable will nuke the value when the mouse is down.
        canvas.addEventListener('mousedown', () => {
          if (runtime.mode === 'explore') {
            click = true;
            setTimeout(() => {
              click = false;
            }, 300);
          }
        });

        // Next we will add another zoom option, click to zoom. This time the origin will
        // be where our mouse is in relation to the world.
        canvas.addEventListener('click', ({ pageX, pageY, defaultPrevented }) => {
          if (click && runtime.mode === 'explore') {
            zoomTo(
              0.6,
              runtime.viewerToWorld(pageX * devicePixelRatio - canvasPos.left, pageY * devicePixelRatio - canvasPos.top)
            );
          }
        });
      }

      if (printX || printY || enableClickToZoom) {
        // On mouse move we will display the world co-ordinates over the mouse in the UI.
        canvas.addEventListener('mousemove', ({ pageX, pageY }) => {
          // Here we stop a click if the mouse has moved (starting a drag).
          click = false;
          const { x, y } = runtime.viewerToWorld(
            pageX * devicePixelRatio - canvasPos.left,
            devicePixelRatio * pageY - canvasPos.top
          );

          if (printX) {
            printX.innerText = '' + Math.floor(x);
          }
          if (printY) {
            printY.innerText = '' + Math.floor(y);
          }
        });
      }
    },
    stop() {
      // no-op.
    },
  };
};