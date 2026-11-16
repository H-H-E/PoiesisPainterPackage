# Third-party reference notices and provenance

This file records the five **reference repositories studied** for the Poiesis painting engine, at the commits pinned in [references.lock.json](references.lock.json). It is a source-audit and future-distribution checklist, **not** an admission that their software, shaders, datasets, artwork or assets are copied into the current Poiesis package.

**Current distribution assessment at baseline commit 8665223329eedb138d90e81e1e8254fdc92cc99d:** The painting code in `src/**`, studio and build scripts is described as original; the inspected [MaterialSurface](src/materials.ts), [Rasterizer](src/rasterizer.ts) and [painter](src/painter.ts) are not imports of these projects. No reference repositories are runtime dependencies in [package.json](package.json). The audit has not performed a byte-for-byte provenance scan, so this is an observed dependency/source-layout finding, **not a legal guarantee of independent creation**. Build/test-time npm packages are a separate license-compliance concern and are not enumerated as reference source reuse here.

## Reference source inventory

| Studied repository and fixed revision | Actual upstream license read | Copyright attribution from its license | Included in Poiesis now? |
| --- | --- | --- | --- |
| [acamposuribe/p5.brush @ 054f2feb2ec8f98bd6dbb7d676d0335323180d83](https://github.com/acamposuribe/p5.brush/tree/054f2feb2ec8f98bd6dbb7d676d0335323180d83) | [LICENSE.md — MIT](https://github.com/acamposuribe/p5.brush/blob/054f2feb2ec8f98bd6dbb7d676d0335323180d83/LICENSE.md) | Copyright (c) 2023–2026 Alejandro Campos Uribe | **No**; source/documentation cited only |
| [halfprice06/oil-paint-agents @ 09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3](https://github.com/halfprice06/oil-paint-agents/tree/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3) | [LICENSE — MIT](https://github.com/halfprice06/oil-paint-agents/blob/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3/LICENSE) | Copyright (c) 2026 Daniel Price | **No**; scripts/pass art cited only |
| [castavridis/washes-js @ 14e485b6e83dba1b5d02c987ae2ddd2222c60063](https://github.com/castavridis/washes-js/tree/14e485b6e83dba1b5d02c987ae2ddd2222c60063) | [engine/LICENSE — MIT](https://github.com/castavridis/washes-js/blob/14e485b6e83dba1b5d02c987ae2ddd2222c60063/engine/LICENSE) | Copyright (c) 2026 Stephanie | **No**; code/API behavior cited only |
| [enpts/sho @ ffcb4cafb28c710a2b32a21fcef8819d57854780](https://github.com/enpts/sho/tree/ffcb4cafb28c710a2b32a21fcef8819d57854780) | [LICENSE — MIT](https://github.com/enpts/sho/blob/ffcb4cafb28c710a2b32a21fcef8819d57854780/LICENSE) | Copyright (c) 2026 enpitsu | **No**; no sho.js or paper.webp included |
| [lambentLogic/wet-edge @ e4ce2ec7a37d85c17ad16bb3006959bb88a19a73](https://github.com/lambentLogic/wet-edge/tree/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73) | [LICENSE — MIT](https://github.com/lambentLogic/wet-edge/blob/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73/LICENSE) | Copyright (c) 2026 lambentLogic | **No**; GPU shaders/pigment tables not included |

All five license classifications are based on **reading the license file at the exact pinned revision**, not simply guessing from a GitHub badge or public visibility. Each source's [detailed audit](docs/references/README.md) includes source paths and material-mechanism notes. No GitHub star count, popularity, or unpinned HEAD is used for compliance.

## What MIT would require if upstream code were reused

For portions of these five projects licensed under MIT, redistribution of the software or substantial portions requires that the **copyright notice and the permission notice** be included in all copies or substantial portions. MIT includes an “AS IS”, no-warranty clause. An upstream repository's license grant **does not** automatically clear rights to independently owned photos, fonts, datasets, papers or other embedded third-party material. Future maintainers must inspect the exact files reused and preserve original attributions (and any dependency-specific notices), add evidence to this manifest, and re-run packaging checks; do not silently copy an upstream library because both projects happen to use MIT.

The complete verbatim permission notice shared by the inspected MIT licenses is reproduced below for convenient future audit. **It does not replace the file-specific copyright notices above or the actual license file if code is later incorporated.**

> MIT License
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Assets, dependencies and separately governed artifacts

- **wet-edge sample paintings:** [paintings/LICENSE.md](https://github.com/lambentLogic/wet-edge/blob/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73/paintings/LICENSE.md) dedicates the images `paintings/*.png` to **CC0 1.0 Universal** ([CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode)). The JavaScript painting scripts are MIT code. The upstream README describes paintings based in part on public-domain reference photographs, which are **not included** in that repository; verify any photograph separately. **No sample painting or photograph was copied into Poiesis.**
- **wet-edge pigment spectral database:** [README credits](https://github.com/lambentLogic/wet-edge/blob/e4ce2ec7a37d85c17ad16bb3006959bb88a19a73/README.md#L47-L66) describe published spectra from Okumura, Berns, Cultural Heritage Science Open Source Pigments Checker and FOGRA51 data. The upstream code MIT notice is not a replacement for checking each underlying database's reuse conditions. **No tables, spectra or derived colors were copied.**
- **oil-paint-agents pose3d vendor:** upstream has an ancillary [THREE_LICENSE](https://github.com/halfprice06/oil-paint-agents/blob/09a2750b9fe1aa8c31b5741b1139ad1c0d72eef3/.claude/skills/oil-painting/scripts/pose3d/vendor/THREE_LICENSE) for its vendored three.js. It is not part of the current Poiesis code. Recheck vendor attribution before adopting pose3d.
- **p5.brush runtime dependency:** [package.json](https://github.com/acamposuribe/p5.brush/blob/054f2feb2ec8f98bd6dbb7d676d0335323180d83/package.json) declares `simplex-noise`; the p5 adapter also needs p5 as a peer dependency (the standalone build does not). Those dependencies are upstream context, **not Poiesis dependencies**.
- **sho paper texture:** the optional `paper.webp` is an upstream asset; no standalone rights determination was made for that asset, so **do not vendor** it without asset-specific verification.
- **washes-js:** the MIT reference is `engine/LICENSE`, not an assumption that every unrelated file outside `engine/` is identically licensed. Treat optional worker/shader/fixtures/art as separate provenance items before copying.

## Future addition and removal checklist

When proposing actual reuse: (1) identify exact source commit, path and blob hash; (2) identify original authors and complete applicable license text; (3) check third-party dependencies, photos, sample outputs, textures and datasets; (4) keep license/attribution in packaged distribution; (5) add a test that catches lost notices; (6) document what new code is original versus adapted. For derived images inspect content-specific rights, not only the engine's license. Any decision to remove referenced code must check that no distributed copies still require preserved notices.

**Poiesis project LICENSE has not been changed.** This workstream changes attribution documentation only and does not approve or introduce third-party source reuse.
