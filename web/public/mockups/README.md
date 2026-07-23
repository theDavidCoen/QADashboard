# Device mockups

Each device profile lives in its own folder with a frame asset and an entry in `registry.json`.

## Add a new phone

1. Create `web/public/mockups/<id>/` with `frame.png` or `frame.svg`
   - PNG: use a frame with a **transparent screen hole** (e.g. [WithFrame](https://withfra.me/))
   - SVG: use a mask to cut out the screen area (see existing files)

2. Add screen coordinates to `registry.json`:
   ```json
   "my-phone": {
     "label": "My Phone",
     "frame": "/mockups/my-phone/frame.png",
     "frameType": "image",
     "frameAspect": 0.46,
     "screen": { "left": 7, "top": 13, "width": 86, "height": 74 },
     "screenRadius": "2%",
     "match": ["ProductModel", "codename"]
   }
   ```

3. Add matching rules to `config/mockups.yaml`:
   ```yaml
   my-phone:
     match:
       - ProductModel
       - codename
   ```

4. Rebuild the web UI: `cd web && npm run build`

## Screen coordinates

Percentages of the frame image (0–100). Measure the transparent/screen rectangle:
- **left**, **top**: top-left corner of the screen
- **width**, **height**: screen size relative to frame

## Bundled devices

| ID | Device | Frame source |
|----|--------|--------------|
| `iphone-8` | iPhone 8 | [WithFrame](https://withfra.me/shot/iphone-8) (Space Gray PNG) |
| `xiaomi-13t-pro` | Xiaomi 13T Pro | [Figma Xiaomi 13 mockup](https://www.figma.com/design/MJD2ryqOdeC9rkBHE3SsbC/Xiaomi-13-mockup--Community-?node-id=102-8) (front frame PNG) |
| `redmi-note-9-pro` | Redmi Note 9 Pro | Custom SVG |

Fallbacks: `generic-android`, `generic-ios`
