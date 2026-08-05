# 构建与校验脚本

本目录保存项目可复现所需的脚本，不存放业务原始数据。

## V1.2 日常顺序

```text
build_v1_2_release.mjs
  → build_v1_2_workbook.mjs
  → build_v1_2_release.mjs（同一时间戳，登记最终工作簿）
  → validate_v1_2_release.mjs
  → playwright_v1_2_interface_qa.mjs（桌面端 / 手机端）
  → 公开白名单构建与发布
```

| 脚本 | 作用 | 主要输出 |
|---|---|---|
| `build_v1_2_release.mjs` | 生成 V1.2 全部结构化数据和页面数据 | `02_数据清洗/处理后数据/V1.2`、三类字典、质量记录、`03_网页呈现/V1.2/radar-v1-2-data.js` |
| `build_v1_2_workbook.mjs` | 生成并检查 Excel | `饮品热点雷达_V1.2_BI数据中心.xlsx` 和工作簿预览 |
| `validate_v1_2_release.mjs` | 独立重算和对账 | `release_validation_report.json`；失败时退出码非 0 |
| `playwright_v1_2_interface_qa.mjs` | 对本地或线上页面执行桌面/手机回归 | 来源筛选、标签联动、详情、原文、溢出和控制台检查 |
| `build_public_v1_2_release.mjs` | 生成最小化 V1.2 公开网页包 | 只含静态页面与脱敏后的页面必需数据 |
| `build_public_source_v1_2.mjs` | 按白名单生成公开源码包 | 排除原始抓取、完整事实表、账号登记库、历史归档和本地预览 |
| `build_public_release.mjs` | 历史 V1.1 公开包构建器 | 仅用于复现旧公开版本 |

Excel 生成依赖 Codex 工作区提供的表格运行环境；不要在仓库内安装或提交 `node_modules`。历史脚本仅用于复现对应旧版本，不作为 V1.2 日常入口。
