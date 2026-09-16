# Third-party notices

## Inferno

Source: https://github.com/twostraws/Inferno

Reference commit: `a40c7a0bdec03aae1bd0b96c41d6a75451bafd2c`

Referenced blur shader and Swift wrappers: Dale Price. Project copyright: Paul Hudson and other authors.

Historical origin: https://github.com/daprice/Variablur

The files in references/inferno are unmodified reference copies. The WebGPU
adaptation in `src/core` and `src/shaders` is a TypeScript/WGSL rewrite that
preserves the algorithmic behavior described above while making the texture,
coordinate, precision, and lifecycle decisions explicit for WebGPU. It does
not copy the SwiftUI wrappers or Metal source into the distributed runtime.

### Original upstream license and notices

MIT License

Copyright (c) 2023 Paul Hudson and other authors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.



Many shaders were ported to Metal from elsewhere then had comments added, and
some were subsequently extended to add extra functionality. The original authors
and sources and linked below. All licenses are MIT. Any mistakes or performance
problems introduced in the porting process are entirely my fault.


Circle, Circle Wave, Diamond, Diamond Wave
---
Based on: https://gl-transitions.com/editor/PolkaDotsCurtain
Original author: bobylito,
Metal port and enhancements: Paul Hudson
License: MIT


Crosswarp
---
Based on: https://gl-transitions.com/editor/crosswarp
Original author: Eke Péter
Metal port: Paul Hudson
License: MIT


Radial
---
Based on: https://gl-transitions.com/editor/Radial
Original author: Xaychru / gre
Metal port: Paul Hudson
License: MIT


Swirl
---
Based on: https://gl-transitions.com/editor/Swirl
Author: Sergey Kosarevsky / gre
Metal port: Paul Hudson
License: MIT


Wind
---
Based on: https://gl-transitions.com/editor/wind
Original author: gre
Metal port: Paul Hudson
License: MIT

Genie
---
Based on: https://www.shadertoy.com/view/flyfRt
Original author: altaha-ansari
Metal port: twodayslate
License: MIT
