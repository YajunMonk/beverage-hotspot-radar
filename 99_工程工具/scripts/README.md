# 公开构建与验收脚本

- `build_public_release.mjs`：从 `03_网页呈现/V1.1` 生成最小公开网页包，并移除小红书临时查询参数。
- `playwright_v1_1_interface_qa.js`：真实浏览器交互验收脚本。
- `playwright_v1_1_interface_qa.spec.js`：对应的 Playwright 测试入口。

本分支不包含 V1.0 冻结基线、完整处理数据和 Excel 输入，因此不提供全量数据重建脚本。
