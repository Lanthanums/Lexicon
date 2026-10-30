# Upstream license sources

`radix-ui-LICENSE.txt` is the MIT license from the official [Radix Primitives repository](https://github.com/radix-ui/primitives/blob/main/LICENSE), copyright 2022 WorkOS. Retrieved as upstream Git blob `a18858fb7b014098cba85703e66609be66a26ef5`. Several Radix npm packages declare MIT but omit a license file from their published package; the build uses this upstream text for those packages.

All other browser dependency license texts are collected from the exact npm packages used by the production build. The package lock records their versions and integrity hashes.

`react-remove-scroll-bar-LICENSE.txt` comes from the official [react-remove-scroll-bar repository](https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE), upstream Git blob `7c08c3990396ecefd90f99ff5d9a34f26f5b5616`, copyright 2025 Anton Korzunov. Its npm package declares MIT but omits this file.

`shadcn-ui-LICENSE.txt` retains the license of the component templates from [shadcn/ui](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md), upstream Git blob `fad4d887a681dd49233e5ed01ee2c7a1513089a0`, copyright 2023 shadcn. The source components reference this system in components.json.
