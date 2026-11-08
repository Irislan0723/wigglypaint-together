# Third-party notices

## WigglyPaint and Decker

WigglyPaint and Decker were created by John Earnest (Internet Janitor). WigglyPaint’s upstream project page lists its code under MIT and its assets under CC0. [Upstream project](https://internet-janitor.itch.io/wigglypaint)

This repository includes an unmodified standalone HTML export at `public/vendor/wigglypaint/original.html`. The copy was retrieved on 2026-10-25 and has SHA-256 `e5b44f1972c885f918b8bd7ea82c4254925d5b2e493fe12a7a26c8f61362d2a3`. [Original HTML](https://beyondloom.com/tools/wigglypaint.html)

The studio serves that export with a small script added to bridge canvas state. The server renderer reuses Decker’s Lil interpreter, WigglyPaint brush behavior and GIF encoding. The headless rendering and shared-canvas adapters are independent of the upstream project.

The [upstream MIT notice](public/vendor/wigglypaint/LICENSE.txt) accompanies the vendored copy. For Decker’s source and license, see the [upstream repository](https://github.com/JohnEarnest/Decker) and its [license](https://github.com/JohnEarnest/Decker/blob/main/LICENSE.txt).
