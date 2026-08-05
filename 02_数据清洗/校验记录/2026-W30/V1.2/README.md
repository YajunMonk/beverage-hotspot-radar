# V1.2 数据与工作簿验收说明

统计周期：`2026-W30`；构建版本：`V1.2`；规则版本：`bi-tag-rule-v1.2`；指标版本：`bi-metric-v1.2`。

## 已通过

| 验收项 | 结果 | 证据 |
|---|---:|---|
| 发布校验 | 245/245 通过，0 失败 | [release_validation_report.json](release_validation_report.json) |
| 主键、外键和粒度 | 56 项通过 | 同上 |
| 指标重算与 BI 对账 | 81 项通过 | 同上及 [metric_reconciliation.csv](metric_reconciliation.csv) |
| V1.1 不可变输入 | 13 项通过 | [v1.1_immutable_fingerprints.json](v1.1_immutable_fingerprints.json) |
| 39 条复核决定 | 35 条通过、4 条驳回、待复核 0 | `处理后数据/V1.2/.../02_AI打标与人工复核` |
| 页面数据与 BI | 8 项通过 | 发布校验报告 |
| Excel 工作簿 | 16 个工作表，公式错误 0，16 页全部渲染 | `02_数据清洗/处理后数据/V1.2/饮品热点雷达_V1.2_BI数据中心.xlsx` |

## 已披露但不阻断发布的限制

1. 94 条品牌内容暂未采集分享数，不能计算包含分享的互动指标。
2. 94 条品牌内容的内容形式仍为未知，暂不做图文/视频格式对比。
3. 29 条三方/KOC 线索缺少结构化 `captured_at` 与 `run_id`，下一轮抓取需补齐。
4. 当前只有 1 个完整可比周期，因此环比和趋势功能禁用。
5. 点赞快照龄从 3.7 到 155.7 小时不等，跨内容比较只能作为描述性观察。

上述限制不会被填成零，也不会包装成完整趋势。详情见 [data_quality_report.json](data_quality_report.json) 与 [data_quality_checks.csv](data_quality_checks.csv)。
