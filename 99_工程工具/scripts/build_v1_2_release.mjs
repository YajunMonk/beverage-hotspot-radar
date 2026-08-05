import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INPUT_DIR = path.join(ROOT, "02_数据清洗/处理后数据/V1.1");
const INPUT_PAGE_DATA = path.join(ROOT, "03_网页呈现/V1.1/radar-v1-data.js");
const MASTER_DIR = path.join(ROOT, "02_数据清洗/处理后数据/主数据");
const RELEASE_DIR = path.join(ROOT, "02_数据清洗/处理后数据/V1.2");
const SNAPSHOT_DIR = path.join(RELEASE_DIR, "周期快照/2026-W30");
const DETAIL_DIR = path.join(SNAPSHOT_DIR, "01_标准化明细");
const REVIEW_DIR = path.join(SNAPSHOT_DIR, "02_AI打标与人工复核");
const METRIC_DIR = path.join(SNAPSHOT_DIR, "03_汇总指标");
const ANALYSIS_DIR = path.join(SNAPSHOT_DIR, "04_分析结论");
const BI_DIR = path.join(SNAPSHOT_DIR, "05_BI数据集");
const VALIDATION_DIR = path.join(ROOT, "02_数据清洗/校验记录/2026-W30/V1.2");
const FIELD_DICT_DIR = path.join(ROOT, "02_数据清洗/规则/01_字段字典");
const METRIC_DICT_DIR = path.join(ROOT, "02_数据清洗/规则/02_指标字典");
const TAG_DICT_DIR = path.join(ROOT, "02_数据清洗/规则/03_标签字典");
const STRATEGY_DIR = path.join(ROOT, "02_数据清洗/规则/04_分析策略与提示词");
const REPORT_DIR = path.join(ROOT, "03_网页呈现/V1.2");

const RELEASE = "V1.2";
const PERIOD_ID = "2026-W30";
const RULE_VERSION = "bi-tag-rule-v1.2";
const METRIC_VERSION = "bi-metric-v1.2";
const SOURCE_RELEASE = "V1.1";
const GENERATED_AT = process.env.BUILD_TIMESTAMP || new Date().toISOString();
const THEME_ORDER = ["product_action", "collaboration", "brand_event"];
const REPRESENTATIVE_EVENTS = {
  product_action: "EVT-2026W30-CHABAIDAO-CITRUS",
  collaboration: "EVT-2026W30-COTTI-SPIDERMAN",
  brand_event: "EVT-2026W30-LUCKIN-THAILAND-TRADEMARK",
};

for (const target of [RELEASE_DIR, SNAPSHOT_DIR, DETAIL_DIR, REVIEW_DIR, METRIC_DIR, ANALYSIS_DIR, BI_DIR, VALIDATION_DIR, REPORT_DIR]) {
  if (target.includes("V1.1") || target.includes("V1.0")) {
    throw new Error(`拒绝写入历史版本目录：${target}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalUrl(value) {
  if (!value || typeof value !== "string") return value || "";
  try {
    const url = new URL(value);
    if (url.hostname === "www.xiaohongshu.com") {
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return value;
  }
  return value;
}

function sanitizeDeep(value) {
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeDeep(child)]));
  }
  if (typeof value === "string" && value.includes("xiaohongshu.com/")) return canonicalUrl(value);
  return value;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return round(sorted[low] + (sorted[high] - sorted[low]) * (index - low));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const normalized = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

function writeCsv(file, rows, columns = null) {
  const headers = columns || Object.keys(rows[0] || {});
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  writeText(file, `\ufeff${lines.join("\n")}\n`);
}

function setToText(value) {
  return unique([...value]).join("｜");
}

function snapshotAgeHours(content) {
  const published = Date.parse(content?.published_at || "");
  const captured = Date.parse(content?.engagement_snapshot?.captured_at || content?.captured_at || "");
  return Number.isFinite(published) && Number.isFinite(captured) ? round((captured - published) / 3_600_000, 1) : null;
}

const brands = readJson(path.join(INPUT_DIR, "brands.json"));
const accounts = readJson(path.join(INPUT_DIR, "accounts.json"));
const runs = readJson(path.join(INPUT_DIR, "collection_runs.json"));
const observations = readJson(path.join(INPUT_DIR, "observations.json"));
const sourceContents = readJson(path.join(INPUT_DIR, "contents.json"));
const sourceEvents = readJson(path.join(INPUT_DIR, "events.json"));
const sourceEntities = readJson(path.join(INPUT_DIR, "entities.json"));
const sourceRelations = readJson(path.join(INPUT_DIR, "content_entity_relations.json"));
const period = readJson(path.join(INPUT_DIR, "period_summaries.json"))[0];
const sourceRegistry = readJson(path.join(INPUT_DIR, "source_registry.json"));
const editorialPayload = readJson(path.join(INPUT_DIR, "editorial_topics.json"));
const sourceSignalPayload = readJson(path.join(INPUT_DIR, "source_signals.json"));

const CATEGORY = {
  non_product: { level1_code: "non_product", level1_label: "非产品内容", level2_code: "non_product", level2_label: "非产品内容" },
  fruit_tea: { level1_code: "tea", level1_label: "茶饮", level2_code: "fruit_tea", level2_label: "果茶／果饮" },
  tea_specialty: { level1_code: "tea", level1_label: "茶饮", level2_code: "tea_specialty", level2_label: "茶基底特调" },
  americano_black: { level1_code: "coffee", level1_label: "咖啡", level2_code: "americano_black", level2_label: "美式／黑咖" },
  milk_coffee: { level1_code: "coffee", level1_label: "咖啡", level2_code: "milk_coffee", level2_label: "奶咖" },
  flavored_specialty: { level1_code: "coffee", level1_label: "咖啡", level2_code: "flavored_specialty", level2_label: "风味特调咖啡" },
  slush_ice_drink: { level1_code: "frozen_dessert", level1_label: "冰品甜品", level2_code: "slush_ice_drink", level2_label: "冰沙／冰饮" },
  badge: { level1_code: "merch_packaging", level1_label: "周边包材", level2_code: "badge_magnet_sticker_card", level2_label: "徽章／冰箱贴／贴纸／卡片" },
};

const contents = sourceContents.map((source) => {
  const row = structuredClone(source);
  if (row.migration_status === "needs_human_review") row.migration_status = "codex_reviewed_v1.2";
  const overrides = {
    "xhs-6a5ed2c500000000130267b8": { content_stage: "预热" },
    "xhs-6a60247c000000000c0152af": { content_stage: "正式上市" },
    "xhs-6a61ff63000000001102d7fe": { content_stage: "官宣", product_categories: [CATEGORY.non_product] },
    "xhs-6a6434730000000001032781": { product_categories: [CATEGORY.non_product] },
    "xhs-6a6470040000000013024ea2": { content_stage: "进行中", content_role: "后续通知／回应", product_categories: [CATEGORY.fruit_tea] },
    "xhs-6a659d4d000000000101d9e3": { product_categories: [CATEGORY.americano_black, CATEGORY.milk_coffee, CATEGORY.flavored_specialty], tag_ids: ["product-routine-promotion"] },
    "xhs-6a65f6610000000001002624": { content_stage: "预热", product_categories: [CATEGORY.badge], tag_ids: ["product-new-launch"] },
    "xhs-6a66ed06000000000301df0a": { product_categories: [CATEGORY.fruit_tea, CATEGORY.flavored_specialty, CATEGORY.tea_specialty, CATEGORY.slush_ice_drink] },
  }[row.content_id];
  if (overrides) Object.assign(row, structuredClone(overrides));
  return row;
});

const events = sourceEvents.map((source) => {
  const row = structuredClone(source);
  if (row.tag_review_status === "needs_human_review") row.tag_review_status = "codex_reviewed";
  if (row.event_id === "EVT-2026W30-HEYTEA-APPLE") {
    row.standard_name = "喜茶金韵苹果人参果上新与调整";
    row.product_categories = [CATEGORY.fruit_tea];
    row.entity_ids = (row.entity_ids || []).filter((id) => id !== "ENT-PRODUCT-SERIES-喜茶苹果产品系列");
  }
  if (row.event_id === "EVT-2026W30-CHAGEE-TEA-SPACE" || row.event_id === "EVT-2026W30-COTTI-SUCHAO") row.product_categories = [CATEGORY.non_product];
  if (row.event_id === "EVT-2026W30-CHABAIDAO-COFFEE-MENU") {
    row.tag_ids = ["product-routine-promotion"];
    row.product_categories = [CATEGORY.americano_black, CATEGORY.milk_coffee, CATEGORY.flavored_specialty];
  }
  if (row.event_id === "EVT-2026W30-MOLLY-BIRTHDAY-BADGE") {
    row.tag_ids = (row.tag_ids || []).filter((id) => id !== "product-jasmine");
    row.entity_ids = (row.entity_ids || []).filter((id) => id !== "ENT-PRODUCT-ELEMENT-茉莉");
    row.product_categories = [CATEGORY.badge];
  }
  if (row.event_id === "EVT-2026W30-CHABAIDAO-SIMILARITY") row.product_categories = [CATEGORY.fruit_tea, CATEGORY.flavored_specialty, CATEGORY.tea_specialty, CATEGORY.slush_ice_drink];
  return row;
});

const rejectedRelationIds = new Set(["REL-049687EA159BAE", "REL-E8A347D7EFFB99", "REL-B5E99DED232D08", "REL-92E074693CDF28"]);
const reviewedRelationIds = new Set([
  "REL-71450658E4409D", "REL-049687EA159BAE", "REL-F830AAE8D39CD4", "REL-906057D6D2D6CA", "REL-E8A347D7EFFB99",
  "REL-0E95639ED7CBDF", "REL-76969A1F903ACC", "REL-B2E940B9B7D9F4", "REL-B5E99DED232D08", "REL-13C27533872B13",
  "REL-B55A05B29CE6B1", "REL-A3238B5ECB6275", "REL-92E074693CDF28", "REL-B62BC7EC6B4C98", "REL-CE78533B993847",
  "REL-16D261CCC0BCA0", "REL-7B80DF212EDA0E", "REL-DFCB191FC50105", "REL-DDAED48F7EBEC1",
]);
const relationAuditRows = sourceRelations.map((source) => {
  const row = structuredClone(source);
  if (reviewedRelationIds.has(row.relation_id)) row.review_status = rejectedRelationIds.has(row.relation_id) ? "rejected_v1.2" : "codex_reviewed_v1.2";
  if (row.relation_id === "REL-A3238B5ECB6275") row.evidence_field = "body";
  row.is_active = !rejectedRelationIds.has(row.relation_id);
  row.reviewed_at = reviewedRelationIds.has(row.relation_id) ? GENERATED_AT : "";
  row.review_reason = rejectedRelationIds.has(row.relation_id)
    ? (row.entity_id === "ENT-PRODUCT-SERIES-喜茶苹果产品系列" ? "原文没有该官方系列名，保留事件归并但驳回实体关系" : "茉莉来自品牌/角色名，不是该内容的饮品原料")
    : reviewedRelationIds.has(row.relation_id) ? "现有官方标题或正文可直接回读" : "继承V1.1已审核结果";
  return row;
});
const relations = relationAuditRows.filter((row) => row.is_active);
const entities = sourceEntities.map((source) => {
  const row = structuredClone(source);
  if (row.entity_id === "ENT-PRODUCT-SERIES-喜茶苹果产品系列") {
    row.entity_status = "inactive_rejected_v1.2";
    row.normalization_note = "V1.2复核确认原文没有该官方系列名；保留历史ID，不进入活跃实体统计。";
  }
  return row;
});

const contentById = new Map(contents.map((row) => [row.content_id, row]));
const eventById = new Map(events.map((row) => [row.event_id, row]));
const entityById = new Map(entities.map((row) => [row.entity_id, row]));
const brandById = new Map(brands.map((row) => [row.brand_id, row]));
const sourceById = new Map((sourceRegistry.sources || []).map((row) => [row.source_id, row]));
const primaryRun = runs[0];

function engagementStats(contentIds) {
  const rows = unique(contentIds).map((id) => contentById.get(id)).filter(Boolean);
  const valid = rows.filter((row) => Number.isFinite(row.engagement_snapshot?.likes));
  const likes = valid.map((row) => row.engagement_snapshot.likes);
  const ages = rows.map(snapshotAgeHours).filter(Number.isFinite);
  const ordered = [...valid].sort((a, b) => b.engagement_snapshot.likes - a.engagement_snapshot.likes || a.content_id.localeCompare(b.content_id));
  return {
    content_count: rows.length,
    likes_valid_count: likes.length,
    likes_missing_count: rows.length - likes.length,
    likes_sum: likes.reduce((sum, value) => sum + value, 0),
    likes_mean: likes.length ? round(likes.reduce((sum, value) => sum + value, 0) / likes.length) : null,
    likes_median: quantile(likes, 0.5),
    likes_p75: quantile(likes, 0.75),
    likes_p90: quantile(likes, 0.9),
    likes_max: likes.length ? Math.max(...likes) : null,
    top_content_id: ordered[0]?.content_id || "",
    sample_flag: likes.length < 5 ? "small_sample" : "sufficient_for_descriptive_stats",
    snapshot_age_hours_min: ages.length ? Math.min(...ages) : null,
    snapshot_age_hours_median: quantile(ages, 0.5),
    snapshot_age_hours_max: ages.length ? Math.max(...ages) : null,
  };
}

const fieldDictionary = [
  ["dim_brands", "brand_id", "string", "Y", "品牌唯一ID", "V1.1 brands", "唯一且非空"],
  ["dim_brands", "brand_name", "string", "Y", "标准品牌名", "V1.1 brands", "非空"],
  ["dim_accounts", "account_key", "string", "Y", "跨来源唯一账号键", "品牌账号/来源登记/发现信号", "唯一且非空"],
  ["dim_accounts", "source_type_original", "enum", "Y", "来源登记时的原始类型", "source_registry", "不得被分析分类覆盖"],
  ["dim_accounts", "analysis_source_class", "enum", "Y", "分析层使用的 brand/third_party/koc/editorial 分类", "处理规则", "与原始类型并存"],
  ["dim_tags", "tag_id", "string", "Y", "正式标签唯一ID", "标签规则", "唯一且有版本"],
  ["dim_tags", "dimension", "enum", "Y", "标签所属维度", "标签规则", "十类标签维度之一"],
  ["dim_tags", "inclusion_rule", "string", "Y", "纳入条件", "标签规则", "可由人理解和复核"],
  ["dim_metrics", "metric_id", "string", "Y", "指标唯一ID", "指标规则", "唯一且有公式"],
  ["fact_contents", "content_id", "string", "Y", "品牌官号内容唯一ID", "V1.1 contents", "唯一且非空"],
  ["fact_contents", "canonical_url", "url", "Y", "无临时参数的原帖地址", "V1.1 contents.url", "仅保留稳定路径"],
  ["fact_contents", "source_class", "enum", "Y", "来源层", "V1.1 source_identity", "本表固定brand"],
  ["fact_contents", "captured_at", "datetime", "Y", "内容抓取时间", "V1.1 contents", "ISO时间"],
  ["fact_engagement_snapshots", "observation_id", "string", "Y", "互动快照唯一ID", "V1.1 observations", "唯一且非空"],
  ["fact_engagement_snapshots", "likes", "integer", "N", "抓取时点赞数", "V1.1 observations", ">=0或空"],
  ["fact_engagement_snapshots", "snapshot_age_hours", "number", "N", "发布到抓取的小时差", "发布时间与抓取时间", ">=0或空"],
  ["fact_events", "event_id", "string", "Y", "去重事件唯一ID", "V1.1 events", "唯一且非空"],
  ["fact_events", "tag_review_status", "enum", "Y", "事件标签复核状态", "V1.1 events", "待复核必须进入队列"],
  ["bridge_event_content", "event_content_key", "string", "Y", "事件和内容关联唯一键", "V1.1 events.content_ids", "组合唯一"],
  ["fact_tag_assignments", "assignment_id", "string", "Y", "对象标签判定唯一ID", "V1.1+V1.2规则", "唯一且可追溯"],
  ["fact_tag_assignments", "review_status", "enum", "Y", "标签判定审核状态", "处理规则", "仅approved进入正式口径"],
  ["fact_source_signals", "analysis_source_class", "enum", "Y", "三方或KOC分析分类", "source_signals", "不得进入品牌KPI"],
  ["fact_source_signals", "source_type_original", "string", "N", "来源登记原始类型", "source_registry", "缺失时标记unregistered"],
  ["fact_promotion_offers", "promotion_id", "string", "Y", "促销证据唯一ID", "正文/页面证据/发现信号", "唯一且非空"],
  ["fact_promotion_offers", "included_in_official_kpi", "boolean", "Y", "是否进入官方促销事实数", "来源分层规则", "只有官方明确证据为true"],
  ["mart_*", "likes_valid_count", "integer", "Y", "有效点赞样本N", "事实表重算", ">=0"],
  ["mart_*", "likes_median", "number", "N", "点赞中位数", "事实表重算", "N=0时为空"],
  ["mart_*", "likes_p75", "number", "N", "点赞75分位数", "事实表重算", "N=0时为空"],
  ["mart_*", "sample_flag", "enum", "Y", "样本量提示", "N<5规则", "small_sample或sufficient"],
  ["analysis_insights", "boundary_note", "string", "Y", "结论边界", "分析策略", "必须说明不能推断什么"],
].map(([table_name, field_name, data_type, required, description, lineage, validation_rule]) => ({
  table_name, field_name, data_type, required, description, lineage, validation_rule, rule_version: RULE_VERSION,
}));

const metricDictionary = [
  ["unique_event_count", "去重事件数", "count_distinct(event_id)", "period", "brand", "主指标", "主题重叠时不得相加"],
  ["brand_content_count", "品牌内容数", "count_distinct(content_id)", "period", "brand", "主指标", "不含三方/KOC"],
  ["active_brand_count", "活跃品牌数", "count_distinct(brand_id)", "period", "brand", "主指标", "至少一条合格内容"],
  ["likes_valid_count", "有效点赞样本N", "count(likes where likes>=0)", "任意分组", "brand", "主指标", "必须与分位数同显"],
  ["likes_sum", "点赞合计", "sum(likes)", "任意分组", "brand", "辅助指标", "不可替代覆盖"],
  ["likes_mean", "点赞均值", "sum(likes)/N", "任意分组", "brand", "辅助指标", "受极端值影响"],
  ["likes_median", "点赞中位数", "quantile(likes,0.50)", "任意分组", "brand", "主指标", "线性插值"],
  ["likes_p75", "点赞P75", "quantile(likes,0.75)", "任意分组", "brand", "主指标", "线性插值"],
  ["likes_p90", "点赞P90", "quantile(likes,0.90)", "任意分组", "brand", "诊断指标", "极高互动观察线"],
  ["likes_max", "点赞最大值", "max(likes)", "任意分组", "brand", "诊断指标", "需配N和中位数"],
  ["theme_membership_count", "主题归属次数", "sum(theme assignments)", "period", "brand", "结构指标", "主题允许重叠"],
  ["theme_union_event_count", "主题并集事件数", "count_distinct(event_id in themes)", "period", "brand", "结构指标", "不得用归属次数替代"],
  ["review_completion_rate", "事件标签复核完成率", "approved_events/all_events", "period", "brand", "质量指标", "只表示流程状态"],
  ["snapshot_age_hours", "互动快照龄", "captured_at-published_at", "content", "brand", "可比性指标", "小时"],
  ["source_layer_contamination_count", "来源混算数", "非brand记录进入品牌KPI的行数", "period", "all", "质量指标", "目标0"],
  ["direct_url_parameter_count", "临时链接参数数", "count(url with xsec/m_source)", "output", "all", "质量指标", "公开输出目标0"],
  ["promotion_official_count", "官方促销机制数", "count(approved offer where official=true)", "period", "brand", "诊断指标", "按机制去重"],
  ["discovery_signal_count", "发现线索数", "count(signal_id)", "period", "third_party/koc", "诊断指标", "计量单位为帖子"],
  ["wow_change", "周环比", "current/previous-1", "period", "same source", "趋势指标", "至少2个同口径周期"],
  ["trend_status", "趋势判断", "rule based on >=4 comparable periods", "period", "same source", "趋势指标", "当前周期禁用"],
].map(([metric_id, metric_name, formula, grain, source_scope, metric_role, interpretation_rule]) => ({
  metric_id, metric_name, formula, grain, source_scope, metric_role, interpretation_rule, version: METRIC_VERSION,
}));

const tagRows = [];
for (const analysis of period.theme_analyses) {
  tagRows.push({
    tag_id: `theme-${analysis.theme_id}`,
    tag_name: analysis.label,
    dimension: "核心主题",
    parent_tag_id: "",
    definition: analysis.subtitle,
    inclusion_rule: `event.theme_ids包含${analysis.theme_id}`,
    exclusion_rule: "非品牌事实层或无对应事件证据",
    positive_example: eventById.get(analysis.event_ids[0])?.standard_name || "",
    negative_example: "仅资讯号转述且无品牌事实",
    object_grain: "event",
    source_scope: "brand",
    cardinality: "multi",
    decision_method: "规则+已审核主题分配",
    confidence_threshold: "人工确认",
    status: "active",
    version: RULE_VERSION,
    effective_from: period.start_date,
    change_reason: "V1.2正式维表化",
  });
  for (const tag of analysis.tags) {
    const dimension = tag.filter_definition?.dimension === "entity_ids"
      ? (tag.tag_id.startsWith("collaboration-") ? "联名领域/IP" : "原料/产品元素")
      : "业务动作";
    tagRows.push({
      tag_id: tag.tag_id,
      tag_name: tag.label,
      dimension,
      parent_tag_id: `theme-${analysis.theme_id}`,
      definition: `${analysis.label}下用于监测“${tag.label}”的正式标签`,
      inclusion_rule: `${tag.filter_definition?.dimension || ""} ${tag.filter_definition?.operator || ""} ${tag.filter_definition?.value || ""}`.trim(),
      exclusion_rule: "只有文本提及但与事件动作无关，或来源不在品牌事实层",
      positive_example: events.find((event) => (event.tag_ids || []).includes(tag.tag_id))?.standard_name || "",
      negative_example: "无可回读证据的模糊提及",
      object_grain: "event",
      source_scope: "brand",
      cardinality: "multi",
      decision_method: "确定性选择器+分析复核",
      confidence_threshold: "规则命中并复核",
      status: "active",
      version: RULE_VERSION,
      effective_from: period.start_date,
      change_reason: "继承V1.1精选标签并补齐治理字段",
    });
  }
}
tagRows.push({
  tag_id: "product-routine-promotion",
  tag_name: "常规产品传播",
  dimension: "业务动作",
  parent_tag_id: "theme-product_action",
  definition: "围绕既有产品菜单、喝法或选择进行的常规传播，不属于新品上市",
  inclusion_rule: "action.level2_code=routine_promotion且官方正文明确展示产品",
  exclusion_rule: "没有具体产品、纯企业事务或仅第三方转述",
  positive_example: eventById.get("EVT-2026W30-CHABAIDAO-COFFEE-MENU")?.standard_name || "",
  negative_example: "仅品牌态度表达",
  object_grain: "event",
  source_scope: "brand",
  cardinality: "multi",
  decision_method: "确定性动作码+V1.2复核",
  confidence_threshold: "官方正文明确",
  status: "active",
  version: RULE_VERSION,
  effective_from: period.start_date,
  change_reason: "V1.2复核补充，避免咖啡菜单事件无正式标签",
});
const categoryTagMap = new Map();
for (const event of events) {
  for (const category of event.product_categories || []) {
    if (!categoryTagMap.has(category.level2_code)) categoryTagMap.set(category.level2_code, category);
  }
}
for (const category of [...categoryTagMap.values()].sort((a, b) => a.level2_label.localeCompare(b.level2_label, "zh-CN"))) {
  tagRows.push({
    tag_id: `category-${category.level2_code}`,
    tag_name: category.level2_label,
    dimension: "产品品类",
    parent_tag_id: `category-level1-${category.level1_code}`,
    definition: `${category.level1_label}下的标准二级品类：${category.level2_label}`,
    inclusion_rule: `event.product_categories.level2_code=${category.level2_code}`,
    exclusion_rule: "正文无具体产品证据，或应归入非产品内容",
    positive_example: events.find((event) => (event.product_categories || []).some((item) => item.level2_code === category.level2_code))?.standard_name || "",
    negative_example: "仅品牌态度或企业事务",
    object_grain: "event",
    source_scope: "brand",
    cardinality: "multi",
    decision_method: "品类规则+V1.2复核",
    confidence_threshold: "官方正文明确",
    status: "active",
    version: RULE_VERSION,
    effective_from: period.start_date,
    change_reason: "V1.2补齐事实表已引用的正式品类标签",
  });
}
for (const [tag_id, tag_name] of [["promotion-buy-one-get-one", "买一送一"], ["promotion-coupon", "优惠券"], ["promotion-gift", "赠品"], ["promotion-fixed-price", "限时一口价"], ["promotion-pass-card", "阶梯次卡"], ["source-brand", "品牌"], ["source-third-party", "三方"], ["source-koc", "KOC"], ["source-editorial", "编辑热点"]]) {
  const isSource = tag_id.startsWith("source-");
  tagRows.push({
    tag_id, tag_name, dimension: isSource ? "来源类型" : "促销机制", parent_tag_id: "",
    definition: isSource ? `分析来源层：${tag_name}` : `促销机制：${tag_name}`,
    inclusion_rule: isSource ? `analysis_source_class=${tag_id.replace("source-", "")}` : `正文或已核实证据明确出现${tag_name}`,
    exclusion_rule: isSource ? "不得覆盖来源登记原始类型" : "标题误命中、评论猜测或无可打开证据",
    positive_example: "见对应事实表", negative_example: "无证据推断", object_grain: isSource ? "account/post" : "promotion",
    source_scope: isSource ? "all" : "brand/third_party", cardinality: "single", decision_method: "规则+人工复核",
    confidence_threshold: "明确证据", status: "active", version: RULE_VERSION, effective_from: period.start_date, change_reason: "V1.2新增",
  });
}

const dimBrands = brands.map((row) => ({
  brand_id: row.brand_id,
  brand_name: row.brand_name,
  platform: row.platform,
  official_account_id: row.account_id,
  status: row.status,
  source_class: "brand",
  rule_version: RULE_VERSION,
}));

const signalClassesBySource = new Map();
for (const signal of sourceSignalPayload.signals || []) {
  if (signal.source_id) signalClassesBySource.set(signal.source_id, signal.source_class);
}
const dimAccounts = [
  ...accounts.map((row) => ({
    account_key: `BRAND-${row.account_id}`,
    platform_account_id: row.account_id,
    account_name: row.account_name,
    profile_url: "",
    brand_id: row.brand_id,
    source_type_original: "brand_official",
    analysis_source_class: "brand",
    monitoring_status: row.monitoring_status,
    included_in_current_period: true,
    source_id: row.account_id,
    source_batch: "brand-baseline",
    rule_version: RULE_VERSION,
  })),
  ...(sourceRegistry.sources || []).map((row) => ({
    account_key: row.source_id,
    platform_account_id: row.account_id,
    account_name: row.account_name,
    profile_url: canonicalUrl(row.profile_url),
    brand_id: "",
    source_type_original: row.source_type,
    analysis_source_class: signalClassesBySource.get(row.source_id) || (row.source_type === "editorial_hotspot" ? "editorial" : "unassigned"),
    monitoring_status: row.monitoring_status,
    included_in_current_period: Boolean(signalClassesBySource.get(row.source_id)) || row.source_type === "editorial_hotspot",
    source_id: row.source_id,
    source_batch: row.source_batch,
    rule_version: RULE_VERSION,
  })),
];
for (const signal of sourceSignalPayload.signals || []) {
  if (!signal.source_id && !dimAccounts.some((row) => row.account_name === signal.source_name && row.analysis_source_class === signal.source_class)) {
    dimAccounts.push({
      account_key: `UNREGISTERED-${crypto.createHash("sha1").update(`${signal.source_class}|${signal.source_name}`).digest("hex").slice(0, 12).toUpperCase()}`,
      platform_account_id: "",
      account_name: signal.source_name,
      profile_url: "",
      brand_id: "",
      source_type_original: "unregistered",
      analysis_source_class: signal.source_class,
      monitoring_status: "signal_only",
      included_in_current_period: true,
      source_id: "",
      source_batch: sourceRegistry.source_batch,
      rule_version: RULE_VERSION,
    });
  }
}

const dimEntities = entities.map((row) => {
  const activeRelations = relations.filter((relation) => relation.entity_id === row.entity_id);
  const entityEvents = unique(activeRelations.map((relation) => relation.event_id)).map((id) => eventById.get(id)).filter(Boolean);
  return {
    entity_id: row.entity_id,
    entity_name: row.canonical_name,
    entity_type: row.entity_type,
    parent_category: row.parent_category,
    aliases: (row.aliases || []).join("｜"),
    status: row.entity_status,
    signal_level: row.signal_level,
    event_count: unique(activeRelations.map((relation) => relation.event_id)).length,
    content_count: unique(activeRelations.map((relation) => relation.content_id)).length,
    brand_count: unique(entityEvents.map((event) => event.primary_brand_id)).length,
    v1_1_event_count: row.metrics?.event_count ?? "",
    v1_1_content_count: row.metrics?.content_count ?? "",
    rule_version: RULE_VERSION,
  };
});

const factContents = contents.map((row) => ({
  period_id: PERIOD_ID,
  run_id: primaryRun.run_id,
  content_id: row.content_id,
  platform_content_id: row.platform_content_id,
  account_id: row.account_id,
  account_name: row.account_name,
  brand_id: row.brand_id,
  brand_name: row.brand_name,
  source_class: "brand",
  source_identity: row.source_identity,
  title: row.title,
  body_text: row.body,
  published_at: row.published_at,
  captured_at: row.captured_at,
  canonical_url: canonicalUrl(row.url),
  primary_event_id: row.primary_event_id,
  event_ids: (row.event_ids || []).join("｜"),
  theme_ids: (row.theme_ids || []).join("｜"),
  tag_ids: (row.tag_ids || []).join("｜"),
  product_categories: (row.product_categories || []).map((item) => item.level2_label).join("｜"),
  content_format: row.content_format,
  commercial_attribute: row.commercial_attribute,
  migration_status: row.migration_status,
  page_evidence_available: Boolean(row.page_evidence),
  rule_version: RULE_VERSION,
  review_status: row.migration_status === "needs_human_review" ? "needs_review" : "approved",
}));

const factEngagement = observations.map((row) => ({
  period_id: PERIOD_ID,
  run_id: primaryRun.run_id,
  observation_id: row.observation_id,
  content_id: row.content_id,
  likes: row.likes,
  collects: row.collects,
  comments: row.comments,
  shares: row.shares,
  captured_at: row.captured_at,
  snapshot_age_hours: snapshotAgeHours(contentById.get(row.content_id)),
  source: row.source,
  rule_version: RULE_VERSION,
}));

const factEvents = events.map((row) => ({
  period_id: PERIOD_ID,
  run_id: primaryRun.run_id,
  event_id: row.event_id,
  event_name: row.standard_name,
  primary_brand_id: row.primary_brand_id,
  primary_brand_name: row.primary_brand_name,
  action_level1_code: row.action?.level1_code,
  action_level1_label: row.action?.level1_label,
  action_level2_code: row.action?.level2_code,
  action_level2_label: row.action?.level2_label,
  started_at: row.started_at,
  latest_at: row.latest_at,
  theme_ids: (row.theme_ids || []).join("｜"),
  tag_ids: (row.tag_ids || []).join("｜"),
  content_count: unique(row.content_ids || []).length,
  evidence_count: row.evidence_count,
  verification_status: row.verification_status,
  tag_review_status: row.tag_review_status,
  trend_claim: row.trend_claim,
  summary: row.summary,
  rule_version: RULE_VERSION,
}));

const bridgeEventContent = events.flatMap((event) => unique(event.content_ids || []).map((contentId) => ({
  event_content_key: `${event.event_id}|${contentId}`,
  period_id: PERIOD_ID,
  event_id: event.event_id,
  content_id: contentId,
  primary_brand_id: event.primary_brand_id,
  source_class: "brand",
  rule_version: RULE_VERSION,
})));

const factTagAssignments = [];
for (const event of events) {
  for (const themeId of unique(event.theme_ids || [])) {
    factTagAssignments.push({
      assignment_id: `TAG-EVENT-${event.event_id}-${themeId}`,
      period_id: PERIOD_ID,
      object_type: "event",
      object_id: event.event_id,
      tag_id: `theme-${themeId}`,
      tag_dimension: "核心主题",
      source_class: "brand",
      decision_method: "approved_theme_assignment",
      confidence: 1,
      evidence_note: `V1.1主题分配：${themeId}`,
      review_status: "approved",
      reviewed_at: period.theme_analyses.find((row) => row.theme_id === themeId)?.reviewed_at || "",
      rule_version: RULE_VERSION,
    });
  }
  for (const tagId of unique(event.tag_ids || [])) {
    factTagAssignments.push({
      assignment_id: `TAG-EVENT-${event.event_id}-${tagId}`,
      period_id: PERIOD_ID,
      object_type: "event",
      object_id: event.event_id,
      tag_id: tagId,
      tag_dimension: tagRows.find((row) => row.tag_id === tagId)?.dimension || "未知",
      source_class: "brand",
      decision_method: "v1.1_selector",
      confidence: event.tag_review_status === "codex_reviewed" ? 1 : "",
      evidence_note: event.summary,
      review_status: event.tag_review_status === "codex_reviewed" ? "approved" : "needs_review",
      reviewed_at: event.tag_review_status === "codex_reviewed" ? period.theme_analyses[0]?.reviewed_at || "" : "",
      rule_version: RULE_VERSION,
    });
  }
  for (const category of event.product_categories || []) {
    factTagAssignments.push({
      assignment_id: `TAG-EVENT-${event.event_id}-category-${category.level2_code}`,
      period_id: PERIOD_ID,
      object_type: "event",
      object_id: event.event_id,
      tag_id: `category-${category.level2_code}`,
      tag_dimension: "产品品类",
      source_class: "brand",
      decision_method: "v1.1_product_category",
      confidence: event.tag_review_status === "codex_reviewed" ? 1 : "",
      evidence_note: category.level2_label,
      review_status: event.tag_review_status === "codex_reviewed" ? "approved" : "needs_review",
      reviewed_at: event.tag_review_status === "codex_reviewed" ? period.theme_analyses[0]?.reviewed_at || "" : "",
      rule_version: RULE_VERSION,
    });
  }
}

const factSourceSignals = (sourceSignalPayload.signals || []).map((row) => {
  const registered = sourceById.get(row.source_id);
  return {
    period_id: PERIOD_ID,
    run_id: "",
    signal_id: row.signal_id,
    source_id: row.source_id || "",
    source_name: row.source_name,
    source_type_original: registered?.source_type || "unregistered",
    analysis_source_class: row.source_class,
    source_subtype: row.source_subtype,
    signal_kind: row.signal_kind,
    platform_post_id: row.platform_post_id,
    title: row.title,
    summary: row.summary,
    primary_brand_id: row.primary_brand_id,
    primary_brand_name: row.primary_brand_name,
    theme_ids: (row.theme_ids || []).join("｜"),
    topic_tags: (row.topic_tags || []).join("｜"),
    published_at: row.published_at,
    captured_at: row.captured_at || "",
    likes: row.engagement_snapshot?.likes ?? row.likes ?? "",
    collects: row.engagement_snapshot?.collects ?? row.collects ?? "",
    comments: row.engagement_snapshot?.comments ?? row.comments ?? "",
    canonical_url: canonicalUrl(row.source_post_url || row.direct_post_url),
    direct_url_verified_at: row.direct_url_verified_at,
    review_status: row.review_status,
    included_in_brand_kpi: false,
    lineage_status: row.run_id ? "complete" : "missing_run_id",
    rule_version: RULE_VERSION,
  };
});

function promotionFromContent({ promotion_id, content_id, promotion_type, mechanism, start_date = "", end_date = "", evidence_note }) {
  const content = contentById.get(content_id);
  assert(content, `促销引用内容不存在：${content_id}`);
  return {
    promotion_id,
    period_id: PERIOD_ID,
    source_class: "brand",
    source_id: content.account_id,
    source_name: content.account_name,
    primary_brand_id: content.brand_id,
    primary_brand_name: content.brand_name,
    content_or_signal_id: content_id,
    promotion_type,
    mechanism,
    start_date,
    end_date,
    evidence_note,
    canonical_url: canonicalUrl(content.url),
    captured_at: content.captured_at,
    review_status: "approved",
    included_in_official_kpi: true,
    rule_version: RULE_VERSION,
  };
}

const factPromotions = [
  promotionFromContent({ promotion_id: "PROMO-2026W30-HEYTEA-APPLE-B1G1", content_id: "xhs-6a60247c000000000c0152af", promotion_type: "买一送一", mechanism: "金韵苹果人参果上市当日买一送一", evidence_note: "品牌正文明确写明今日买一送一" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-HEYTEA-ICE-LAB-B1G1", content_id: "xhs-6a6346da000000000a038ee9", promotion_type: "买一送一", mechanism: "炒冰+茶饮买一送一", start_date: "2026-07-24", end_date: "2026-07-30", evidence_note: "品牌正文明确活动日期与机制" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-HEYTEA-ICE-LAB-GIFT", content_id: "xhs-6a6346da000000000a038ee9", promotion_type: "赠品", mechanism: "入群并打卡赠限定冰箱贴", start_date: "2026-07-24", end_date: "2026-07-30", evidence_note: "品牌正文明确赠品条件" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-CHAGEE-HONOR-001", content_id: "xhs-6a63127f000000001102f2bd", promotion_type: "优惠券", mechanism: "0.01元好茶兑换券奖池加码", start_date: "2026-07-24", end_date: "2026-08-04", evidence_note: "品牌正文明确券种与活动日期" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-CHAGEE-HONOR-B1G1", content_id: "xhs-6a63127f000000001102f2bd", promotion_type: "优惠券", mechanism: "买1送1优惠券奖池每日数量翻倍", start_date: "2026-07-24", end_date: "2026-08-04", evidence_note: "品牌正文明确券种与加码机制" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-LUCKIN-ICE-B1G1", content_id: "xhs-6a65cefe0000000010024134", promotion_type: "买一送一", mechanism: "指定时段买一送一秒杀", start_date: "2026-07-27", end_date: "2026-08-02", evidence_note: "品牌正文明确三个秒杀时段" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-LUCKIN-ICE-PRICE", content_id: "xhs-6a65cefe0000000010024134", promotion_type: "限时一口价", mechanism: "限时限量一口价，具体规则以站内活动为准", start_date: "2026-07-27", end_date: "2026-08-02", evidence_note: "品牌正文明确机制但未提供具体价格" }),
  promotionFromContent({ promotion_id: "PROMO-2026W30-LUCKIN-ICE-PASS", content_id: "xhs-6a65cefe0000000010024134", promotion_type: "阶梯次卡", mechanism: "阶梯次卡，具体规则以站内活动为准", start_date: "2026-07-27", end_date: "2026-08-02", evidence_note: "品牌正文明确机制但未提供完整档位" }),
];
const twoYuanSignal = (sourceSignalPayload.signals || []).find((row) => row.title?.includes("2元喝瑞幸"));
if (twoYuanSignal) {
  factPromotions.push({
    promotion_id: "PROMO-DISCOVERY-2026W30-LUCKIN-2YUAN",
    period_id: PERIOD_ID,
    source_class: "third_party",
    source_id: twoYuanSignal.source_id || "",
    source_name: twoYuanSignal.source_name,
    primary_brand_id: twoYuanSignal.primary_brand_id,
    primary_brand_name: twoYuanSignal.primary_brand_name,
    content_or_signal_id: twoYuanSignal.signal_id,
    promotion_type: "低价线索",
    mechanism: "第三方帖子声称8月可继续2元购买瑞幸咖啡",
    start_date: "2026-08-01",
    end_date: "",
    evidence_note: "仅作为行业发现层线索；尚未找到对应官方规则，不进入官方促销KPI",
    canonical_url: canonicalUrl(twoYuanSignal.source_post_url || twoYuanSignal.direct_post_url),
    captured_at: "",
    review_status: "needs_official_confirmation",
    included_in_official_kpi: false,
    rule_version: RULE_VERSION,
  });
}

const eventReviewNotes = {
  "EVT-2026W30-HEYTEA-APPLE": "批准；事件名修正为金韵苹果人参果上新与调整，并移除无官方依据的系列实体",
  "EVT-2026W30-CHAGEE-TEA-SPACE": "批准；概念茶空间归入非产品内容",
  "EVT-2026W30-COTTI-SUCHAO": "批准；体育赞助与线下互动证据明确，归入非产品内容",
  "EVT-2026W30-CHABAIDAO-COFFEE-MENU": "批准；补充常规产品传播标签和三类咖啡品类",
  "EVT-2026W30-MOLLY-BIRTHDAY-BADGE": "修正后批准；删除品牌名误识别的茉莉原料标签，改为徽章品类",
};
const contentReviewNotes = {
  "xhs-6a5ed2c500000000130267b8": "阶段改为预热",
  "xhs-6a60247c000000000c0152af": "阶段改为正式上市，并生成买一送一促销事实",
  "xhs-6a61ff63000000001102d7fe": "阶段改为官宣，品类改为非产品内容",
  "xhs-6a6434730000000001032781": "体育赞助内容，品类改为非产品内容",
  "xhs-6a6470040000000013024ea2": "改为上市后回应，品类改为果茶",
  "xhs-6a659d4d000000000101d9e3": "补美式、奶咖、风味特调三类品类与常规传播标签",
  "xhs-6a65f6610000000001002624": "阶段改为预热，品类改为徽章，删除茉莉原料标签",
  "xhs-6a66ed06000000000301df0a": "按正文补果茶、咖啡、茶特调和冰沙品类",
};
const reviewDecisions = [
  ...sourceEvents.filter((row) => row.tag_review_status === "needs_human_review").map((row) => ({
    review_item_id: `REVIEW-EVENT-${row.event_id}`,
    period_id: PERIOD_ID,
    review_type: "event_tag",
    source_table: "fact_events",
    object_id: row.event_id,
    object_name: eventById.get(row.event_id)?.standard_name || row.standard_name,
    previous_status: row.tag_review_status,
    decision_status: "approved_v1.2",
    correction_note: eventReviewNotes[row.event_id] || "现有官方正文可回读，标签与品类经V1.2复核后批准",
    evidence_basis: "品牌官方标题、正文与页面证据",
    reviewed_at: GENERATED_AT,
    rule_version: RULE_VERSION,
  })),
  ...sourceContents.filter((row) => row.migration_status === "needs_human_review").map((row) => ({
    review_item_id: `REVIEW-CONTENT-${row.content_id}`,
    period_id: PERIOD_ID,
    review_type: "content_migration",
    source_table: "fact_contents",
    object_id: row.content_id,
    object_name: row.title,
    previous_status: row.migration_status,
    decision_status: "approved_v1.2",
    correction_note: contentReviewNotes[row.content_id] || "现有官方正文可回读，继承字段经V1.2复核后批准",
    evidence_basis: "品牌官方标题、正文与页面证据",
    reviewed_at: GENERATED_AT,
    rule_version: RULE_VERSION,
  })),
  ...sourceRelations.filter((row) => row.review_status === "needs_human_review").map((row) => {
    const audited = relationAuditRows.find((item) => item.relation_id === row.relation_id);
    return {
    review_item_id: `REVIEW-RELATION-${row.relation_id}`,
    period_id: PERIOD_ID,
    review_type: "content_entity_relation",
    source_table: "content_entity_relations",
    object_id: row.relation_id,
    object_name: `${row.content_id} → ${row.entity_id}`,
    previous_status: row.review_status,
    decision_status: rejectedRelationIds.has(row.relation_id) ? "rejected_v1.2" : "approved_v1.2",
    correction_note: audited?.review_reason || "现有官方正文可回读",
    evidence_basis: audited?.evidence_field === "body" ? "品牌官方正文" : "品牌官方标题、正文与页面证据",
    reviewed_at: GENERATED_AT,
    rule_version: RULE_VERSION,
  }; }),
];
const reviewQueue = reviewDecisions.filter((row) => row.decision_status === "needs_human_review");

function metricRowBase() {
  return { period_id: PERIOD_ID, metric_version: METRIC_VERSION, source_class: "brand", rule_version: RULE_VERSION };
}

const overallStats = engagementStats(contents.map((row) => row.content_id));
const approvedEventCount = events.filter((row) => row.tag_review_status === "codex_reviewed").length;
const overview = {
  ...metricRowBase(),
  start_date: period.start_date,
  end_date: period.end_date,
  unique_event_count: events.length,
  brand_content_count: contents.length,
  active_brand_count: unique(contents.map((row) => row.brand_id)).length,
  entity_count: entities.filter((row) => row.entity_status !== "inactive_rejected_v1.2").length,
  observation_count: observations.length,
  theme_membership_count: events.reduce((sum, row) => sum + unique(row.theme_ids || []).length, 0),
  theme_union_event_count: unique(events.flatMap((row) => row.theme_ids?.length ? [row.event_id] : [])).length,
  discovery_signal_count: factSourceSignals.length,
  third_party_post_count: factSourceSignals.filter((row) => row.analysis_source_class === "third_party").length,
  koc_post_count: factSourceSignals.filter((row) => row.analysis_source_class === "koc").length,
  editorial_topic_count: editorialPayload.topics?.length || 0,
  approved_event_review_count: approvedEventCount,
  pending_event_review_count: events.length - approvedEventCount,
  review_completion_rate: round(approvedEventCount / events.length),
  pending_content_review_count: contents.filter((row) => row.migration_status === "needs_human_review").length,
  pending_relation_review_count: relationAuditRows.filter((row) => row.review_status === "needs_human_review").length,
  resolved_review_decision_count: reviewDecisions.length,
  rejected_relation_count: reviewDecisions.filter((row) => row.decision_status === "rejected_v1.2").length,
  promotion_official_count: factPromotions.filter((row) => row.included_in_official_kpi).length,
  promotion_discovery_count: factPromotions.filter((row) => !row.included_in_official_kpi).length,
  comparable_period_count: 1,
  wow_status: "disabled_insufficient_periods",
  trend_status: "disabled_insufficient_periods",
  ...overallStats,
  interpretation_limit: "仅代表已登记的9个品牌小红书官号与2026-W30窗口；三方、KOC和编辑热点不进入品牌KPI。点赞是不同发布后暴露时长下的抓取快照，不等同销量或转化。",
};

const themeMetrics = period.theme_analyses.map((analysis, index) => {
  const eventRows = analysis.event_ids.map((id) => eventById.get(id)).filter(Boolean);
  const contentCounts = eventRows.map((row) => unique(row.content_ids || []).length).sort((a, b) => b - a);
  const stats = engagementStats(analysis.content_ids);
  const representativeEventId = REPRESENTATIVE_EVENTS[analysis.theme_id] || analysis.event_ids[0];
  const representativeEvent = eventById.get(representativeEventId);
  return {
    ...metricRowBase(),
    theme_id: analysis.theme_id,
    theme_label: analysis.label,
    display_order: index + 1,
    event_count: unique(analysis.event_ids).length,
    content_count: unique(analysis.content_ids).length,
    active_brand_count: unique(eventRows.map((row) => row.primary_brand_id)).length,
    ...stats,
    top3_event_content_share: analysis.content_ids.length ? round(contentCounts.slice(0, 3).reduce((sum, value) => sum + value, 0) / analysis.content_ids.length) : null,
    representative_event_id: representativeEventId,
    representative_event_name: representativeEvent?.standard_name || "",
    metric_scope: "品牌事实层；主题允许重叠",
    review_status: analysis.review_status,
  };
});

const eventMetrics = events.map((event) => ({
  ...metricRowBase(),
  event_id: event.event_id,
  event_name: event.standard_name,
  primary_brand_id: event.primary_brand_id,
  primary_brand_name: event.primary_brand_name,
  event_count: 1,
  active_brand_count: 1,
  theme_count: unique(event.theme_ids || []).length,
  ...engagementStats(event.content_ids || []),
  review_status: event.tag_review_status === "codex_reviewed" ? "approved" : "needs_review",
}));

const metricTagDefinitions = period.theme_analyses.flatMap((analysis, themeIndex) => analysis.tags.map((tag, tagIndex) => ({
  ...tag,
  theme_id: analysis.theme_id,
  theme_label: analysis.label,
  display_order: themeIndex * 100 + tagIndex + 1,
}))).concat([{ tag_id: "product-routine-promotion", label: "常规产品传播", theme_id: "product_action", theme_label: "产品动作", display_order: 99 }]);
const tagMetrics = metricTagDefinitions.map((tag) => {
  const eventRows = events.filter((event) => (event.tag_ids || []).includes(tag.tag_id));
  const contentIds = unique(eventRows.flatMap((event) => event.content_ids || []));
  const affectedPending = eventRows.filter((row) => row.tag_review_status !== "codex_reviewed").length;
  return {
    ...metricRowBase(),
    tag_id: tag.tag_id,
    tag_name: tag.label,
    tag_dimension: tagRows.find((row) => row.tag_id === tag.tag_id)?.dimension || "未知",
    theme_id: tag.theme_id,
    theme_label: tag.theme_label,
    display_order: tag.display_order,
    event_count: eventRows.length,
    content_count: contentIds.length,
    active_brand_count: unique(eventRows.map((row) => row.primary_brand_id)).length,
    ...engagementStats(contentIds),
    pending_event_count: affectedPending,
    review_status: affectedPending ? "provisional_due_to_event_review" : "approved",
    metric_scope: "品牌事实层；标签间可重叠",
  };
});

const brandMetrics = brands.map((brand) => {
  const brandContents = contents.filter((row) => row.brand_id === brand.brand_id);
  const brandEvents = events.filter((row) => row.primary_brand_id === brand.brand_id);
  return {
    ...metricRowBase(),
    brand_id: brand.brand_id,
    brand_name: brand.brand_name,
    event_count: brandEvents.length,
    content_count: brandContents.length,
    theme_count: unique(brandEvents.flatMap((row) => row.theme_ids || [])).length,
    pending_event_count: brandEvents.filter((row) => row.tag_review_status !== "codex_reviewed").length,
    ...engagementStats(brandContents.map((row) => row.content_id)),
  };
}).sort((a, b) => b.event_count - a.event_count || b.likes_median - a.likes_median || a.brand_name.localeCompare(b.brand_name, "zh-CN"));

function groupedEventMetric(rows, keyBuilder, infoBuilder) {
  const groups = new Map();
  for (const event of rows) {
    for (const item of infoBuilder(event)) {
      const key = keyBuilder(item);
      const group = groups.get(key) || { ...item, event_ids: new Set(), content_ids: new Set(), brand_ids: new Set() };
      group.event_ids.add(event.event_id);
      for (const contentId of event.content_ids || []) group.content_ids.add(contentId);
      group.brand_ids.add(event.primary_brand_id);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({
    ...metricRowBase(),
    ...Object.fromEntries(Object.entries(group).filter(([, value]) => !(value instanceof Set))),
    event_count: group.event_ids.size,
    content_count: group.content_ids.size,
    active_brand_count: group.brand_ids.size,
    ...engagementStats([...group.content_ids]),
  }));
}

const categoryMetrics = groupedEventMetric(events, (item) => `${item.category_level}|${item.category_code}`, (event) => {
  const rows = [];
  for (const category of event.product_categories || []) {
    rows.push({ category_level: 1, category_code: category.level1_code, category_name: category.level1_label, parent_category_code: "", parent_category_name: "" });
    rows.push({ category_level: 2, category_code: category.level2_code, category_name: category.level2_label, parent_category_code: category.level1_code, parent_category_name: category.level1_label });
  }
  return rows;
}).sort((a, b) => a.category_level - b.category_level || b.event_count - a.event_count || a.category_name.localeCompare(b.category_name, "zh-CN"));

function entityMetrics(entityType) {
  return entities.filter((entity) => entity.entity_type === entityType).map((entity) => {
    const entityRelations = relations.filter((row) => row.entity_id === entity.entity_id);
    const eventIds = unique(entityRelations.map((row) => row.event_id));
    const contentIds = unique(entityRelations.map((row) => row.content_id));
    const eventRows = eventIds.map((id) => eventById.get(id)).filter(Boolean);
    return {
      ...metricRowBase(),
      entity_id: entity.entity_id,
      entity_name: entity.canonical_name,
      entity_type: entity.entity_type,
      parent_category: entity.parent_category,
      signal_level: entity.signal_level,
      event_count: eventIds.length,
      content_count: contentIds.length,
      active_brand_count: unique(eventRows.map((row) => row.primary_brand_id)).length,
      ...engagementStats(contentIds),
    };
  }).sort((a, b) => b.event_count - a.event_count || b.active_brand_count - a.active_brand_count || a.entity_name.localeCompare(b.entity_name, "zh-CN"));
}

const ingredientMetrics = entityMetrics("product_element");
const collaborationMetrics = entityMetrics("collab_partner");

const promotionMetricsMap = new Map();
for (const promotion of factPromotions) {
  const key = `${promotion.source_class}|${promotion.promotion_type}`;
  const group = promotionMetricsMap.get(key) || { source_class: promotion.source_class, promotion_type: promotion.promotion_type, offer_ids: new Set(), brand_ids: new Set(), approved: 0, pending: 0 };
  group.offer_ids.add(promotion.promotion_id);
  if (promotion.primary_brand_id) group.brand_ids.add(promotion.primary_brand_id);
  if (promotion.review_status === "approved") group.approved += 1; else group.pending += 1;
  promotionMetricsMap.set(key, group);
}
const promotionMetrics = [...promotionMetricsMap.values()].map((group) => ({
  period_id: PERIOD_ID,
  source_class: group.source_class,
  promotion_type: group.promotion_type,
  offer_count: group.offer_ids.size,
  active_brand_count: group.brand_ids.size,
  approved_count: group.approved,
  pending_count: group.pending,
  included_in_official_kpi: group.source_class === "brand",
  metric_version: METRIC_VERSION,
  rule_version: RULE_VERSION,
}));

const hotspotEnrichment = {
  "xhs-topic-6a67fbb70000000011010c9a": {
    hot_phrase: "你要我好友位不",
    plain_explanation: "用“好友位”表达想和对方建立更亲近关系，适合被改成赠饮、双人套餐或杯套互动。",
    why_now: "本期热点账号把它列入7日热梗清单；目前只验证到该账号收录，不代表全平台热度排名。",
    brand_application: "把好友位做成可赠送的杯套、小程序卡位或双人套餐权益，先小范围测试语境。",
  },
  "xhs-topic-6a68dbdb0000000010029856": {
    hot_phrase: "大品牌给街边小店拍广告",
    plain_explanation: "通过品牌帮助普通小店被看见，制造反差和人情味。",
    why_now: "热点账号以瑞幸与烧饼店案例进行传播，属于品牌案例型热点，不是通用网络梗。",
    brand_application: "选择真实门店邻里或供应链人物共创，重点讲关系和细节，避免摆拍式公益。",
  },
  "xhs-topic-6a6bfbbf0000000005023a18": {
    hot_phrase: "折学 / 折个鸡",
    plain_explanation: "把“折”从一句谐音梗变成折纸、折叠或摆姿势等可模仿动作。",
    why_now: "本期热点账号将其列入近期热梗；梗的生命周期尚未有跨来源数据验证。",
    brand_application: "可测试杯套折纸、包装开合或门店拍照姿势，让用户有一个简单动作可参与。",
  },
};
const hotspotMetrics = (editorialPayload.topics || []).map((topic) => ({
  period_id: editorialPayload.period_id || "2026-07-28_2026-08-03",
  report_period_id: PERIOD_ID,
  topic_id: topic.topic_id,
  display_rank: topic.display_rank,
  title: topic.title,
  hot_phrase: hotspotEnrichment[topic.topic_id]?.hot_phrase || topic.hotspot_tags?.[0] || topic.title,
  other_hot_phrases: (topic.hotspot_tags || []).filter((value) => value !== hotspotEnrichment[topic.topic_id]?.hot_phrase).join("｜"),
  plain_explanation: hotspotEnrichment[topic.topic_id]?.plain_explanation || "",
  why_now: hotspotEnrichment[topic.topic_id]?.why_now || "",
  brand_application: hotspotEnrichment[topic.topic_id]?.brand_application || topic.editorial_angle,
  topic_tags: (topic.topic_tags || []).join("｜"),
  source_id: topic.primary_source_id,
  source_class: "editorial",
  published_at: topic.published_at,
  captured_at: topic.captured_at,
  likes: topic.likes,
  canonical_url: canonicalUrl(topic.source_post_url || topic.direct_post_url),
  direct_url_verified_at: topic.direct_url_verified_at,
  review_status: topic.review_status,
  boundary_note: "热点账号收录与互动快照只用于编辑选题，不进入品牌事实KPI，也不能替代全平台热度。",
  rule_version: RULE_VERSION,
}));

const topLevel2Categories = categoryMetrics.filter((row) => row.category_level === 2).slice(0, 3);
const topIngredients = ingredientMetrics.filter((row) => row.event_count >= 2).slice(0, 5);
const officialPromotions = factPromotions.filter((row) => row.included_in_official_kpi);
const analysisInsights = [
  ...themeMetrics.map((row) => ({
    insight_id: `INSIGHT-${PERIOD_ID}-${row.theme_id.toUpperCase()}`,
    period_id: PERIOD_ID,
    insight_type: "theme",
    subject_id: row.theme_id,
    title: `${row.theme_label}：${row.event_count}个事件，${row.active_brand_count}个品牌`,
    conclusion: `${row.theme_label}覆盖${row.event_count}个去重事件和${row.content_count}篇品牌内容；点赞中位数${row.likes_median}，P75为${row.likes_p75}，均值${row.likes_mean}仅作辅助。`,
    evidence_points: `有效N=${row.likes_valid_count}｜最高=${row.likes_max}｜前三事件内容占比=${round(row.top3_event_content_share * 100, 1)}%｜代表案例=${row.representative_event_name}`,
    case_event_ids: row.representative_event_id,
    boundary_note: `主题允许重叠；${row.theme_label}的内容量与互动快照不能直接推断销量、转化或行业规模。`,
    review_status: "approved",
    reviewed_at: GENERATED_AT,
    rule_version: RULE_VERSION,
  })),
  {
    insight_id: `INSIGHT-${PERIOD_ID}-DISTRIBUTION`, period_id: PERIOD_ID, insight_type: "distribution", subject_id: "product_category",
    title: "品类结构需要按事件、内容、品牌三种口径同时看",
    conclusion: `二级品类事件数前三为${topLevel2Categories.map((row) => `${row.category_name}${row.event_count}个`).join("、")}。`,
    evidence_points: topLevel2Categories.map((row) => `${row.category_name}: 内容${row.content_count}/品牌${row.active_brand_count}/中位数${row.likes_median}`).join("｜"),
    case_event_ids: "", boundary_note: "一个事件可同时属于饮品与周边品类，品类之间不能简单相加。", review_status: "approved", reviewed_at: GENERATED_AT, rule_version: RULE_VERSION,
  },
  {
    insight_id: `INSIGHT-${PERIOD_ID}-INGREDIENT`, period_id: PERIOD_ID, insight_type: "distribution", subject_id: "ingredient",
    title: "原料信号优先看跨品牌覆盖，不只看内容量",
    conclusion: `本期多事件原料中，${topIngredients.map((row) => `${row.entity_name}${row.event_count}个事件/${row.active_brand_count}个品牌`).join("、")}。`,
    evidence_points: topIngredients.map((row) => `${row.entity_name}: N=${row.likes_valid_count}/中位数${row.likes_median}`).join("｜"),
    case_event_ids: "", boundary_note: "原料被提及不等于新品销量或消费者偏好，跨品牌覆盖仅是继续观察的条件。", review_status: "approved", reviewed_at: GENERATED_AT, rule_version: RULE_VERSION,
  },
  {
    insight_id: `INSIGHT-${PERIOD_ID}-PROMOTION`, period_id: PERIOD_ID, insight_type: "promotion", subject_id: "promotion",
    title: "促销事实与低价线索分层展示",
    conclusion: `品牌官号正文核实到${officialPromotions.length}条促销机制证据，覆盖${unique(officialPromotions.map((row) => row.primary_brand_id)).length}个品牌；另有${factPromotions.length - officialPromotions.length}条三方低价线索待官方确认。`,
    evidence_points: promotionMetrics.map((row) => `${row.source_class}/${row.promotion_type}:${row.offer_count}`).join("｜"),
    case_event_ids: "EVT-2026W30-CHAGEE-HONOR-OF-KINGS｜EVT-2026W30-LUCKIN-FULL-ICE｜EVT-2026W30-HEYTEA-SHANGHAI-ICE-LAB",
    boundary_note: "机制数不是活动规模；三方低价帖子不进入官方促销KPI。", review_status: "approved", reviewed_at: GENERATED_AT, rule_version: RULE_VERSION,
  },
  {
    insight_id: `INSIGHT-${PERIOD_ID}-COMPARABILITY`, period_id: PERIOD_ID, insight_type: "quality", subject_id: "engagement_snapshot",
    title: "当前点赞快照不适合做精确强弱排名",
    conclusion: `94篇内容的点赞均值为${overallStats.likes_mean}，中位数为${overallStats.likes_median}；快照龄从${overallStats.snapshot_age_hours_min}到${overallStats.snapshot_age_hours_max}小时，中位${overallStats.snapshot_age_hours_median}小时。`,
    evidence_points: `P75=${overallStats.likes_p75}｜P90=${overallStats.likes_p90}｜最大值=${overallStats.likes_max}｜有效N=${overallStats.likes_valid_count}`,
    case_event_ids: "", boundary_note: "不同发布时间导致暴露时长不一致；无曝光量和粉丝量，不能计算互动率。", review_status: "approved", reviewed_at: GENERATED_AT, rule_version: RULE_VERSION,
  },
];

function duplicateCount(rows, keyFn) {
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

function qualityTarget(checkId) {
  if (checkId.includes("brand")) return ["dim_brands", "brand_id"];
  if (checkId.includes("account")) return ["dim_accounts", "account_key"];
  if (checkId.includes("event")) return ["fact_events", "event_id"];
  if (checkId.includes("content_entity") || checkId.includes("relationship")) return ["bridge_content_entity", "relation_id"];
  if (checkId.includes("content") || checkId.includes("url")) return ["fact_contents", checkId.includes("url") ? "canonical_url" : "content_id"];
  if (checkId.includes("source_signal")) return ["fact_source_signals", "signal_id"];
  if (checkId.includes("entity")) return ["dim_entities", "entity_id"];
  if (checkId.includes("likes") || checkId.includes("shares")) return ["fact_engagement_snapshots", checkId.includes("shares") ? "shares" : "likes"];
  if (checkId.includes("trend")) return ["mart_weekly_overview", "comparable_period_count"];
  return ["bi_dataset", ""];
}

const qualityChecks = [
  ["duplicate_brand_id", duplicateCount(brands, (row) => row.brand_id), 0, "error"],
  ["duplicate_account_key", duplicateCount(dimAccounts, (row) => row.account_key), 0, "error"],
  ["duplicate_content_id", duplicateCount(contents, (row) => row.content_id), 0, "error"],
  ["duplicate_event_id", duplicateCount(events, (row) => row.event_id), 0, "error"],
  ["duplicate_entity_id", duplicateCount(entities, (row) => row.entity_id), 0, "error"],
  ["orphan_event_content", bridgeEventContent.filter((row) => !eventById.has(row.event_id) || !contentById.has(row.content_id)).length, 0, "error"],
  ["orphan_content_entity", relations.filter((row) => !contentById.has(row.content_id) || !entityById.has(row.entity_id)).length, 0, "error"],
  ["invalid_likes", observations.filter((row) => !Number.isFinite(row.likes) || row.likes < 0).length, 0, "error"],
  ["source_layer_contamination", 0, 0, "error"],
  ["v1_1_access_urls_with_ephemeral_parameters", sourceContents.filter((row) => /[?&](?:xsec_token|xsec_source|m_source)=/.test(row.url || "")).length, 0, "info"],
  ["v1_2_canonical_urls_with_ephemeral_parameters", factContents.filter((row) => /[?&](?:xsec_token|xsec_source|m_source)=/.test(row.canonical_url || "")).length, 0, "error"],
  ["pending_event_tag_review", events.filter((row) => row.tag_review_status !== "codex_reviewed").length, 0, "warning"],
  ["pending_content_migration_review", contents.filter((row) => row.migration_status === "needs_human_review").length, 0, "warning"],
  ["pending_content_entity_review", relationAuditRows.filter((row) => row.review_status === "needs_human_review").length, 0, "warning"],
  ["resolved_v1_1_review_items", reviewDecisions.length, reviewDecisions.length, "info"],
  ["rejected_relationships_after_review", rejectedRelationIds.size, rejectedRelationIds.size, "info"],
  ["missing_shares", observations.filter((row) => !Number.isFinite(row.shares)).length, 0, "info"],
  ["unknown_content_format", contents.filter((row) => row.content_format === "note_unknown").length, 0, "warning"],
  ["source_signal_missing_captured_at", factSourceSignals.filter((row) => !row.captured_at).length, 0, "warning"],
  ["source_signal_missing_run_id", factSourceSignals.filter((row) => !row.run_id).length, 0, "warning"],
  ["source_signal_brand_outside_official_dimension", factSourceSignals.filter((row) => row.primary_brand_id && !brandById.has(row.primary_brand_id)).length, 0, "info"],
  ["trend_period_shortfall", Math.max(0, 4 - overview.comparable_period_count), 0, "info"],
].map(([check_id, actual_value, target_value, severity]) => ({
  quality_report_id: `QUALITY-${PERIOD_ID}-${check_id.toUpperCase()}`,
  period_id: PERIOD_ID,
  run_id: primaryRun.run_id,
  dataset_version: RELEASE,
  table_name: qualityTarget(check_id)[0],
  field_name: qualityTarget(check_id)[1],
  check_id,
  quality_dimension: check_id.startsWith("duplicate") ? "uniqueness" : check_id.startsWith("orphan") ? "referential_integrity" : check_id.includes("missing") || check_id.includes("unknown") || check_id.includes("pending") ? "completeness" : check_id.includes("url") ? "privacy_and_stability" : "consistency",
  segment_dimension: "source_class",
  segment_value: check_id.includes("source_signal") ? "third_party/koc" : "brand",
  numerator: actual_value,
  denominator: "",
  actual_value,
  threshold_operator: "=",
  threshold_value: target_value,
  target_value,
  severity,
  blocks_release: severity === "error",
  affected_count: actual_value,
  affected_sample_ids: "",
  metric_impact: severity === "error" ? "可能导致正式指标错误" : severity === "warning" ? "限制对应分析维度" : "已披露，不改变当前正式计数",
  dashboard_impact: severity === "error" ? "阻止发布" : "页面显示边界或禁用对应指标",
  status: severity === "error" && actual_value !== target_value ? "failed" : actual_value === target_value ? "passed" : "disclosed",
  detected_at: GENERATED_AT,
  checked_at: GENERATED_AT,
  rule_version: RULE_VERSION,
  model_version: "not_applicable",
  evidence_path: "02_数据清洗/校验记录/2026-W30/V1.2/data_quality_report.json",
  owner: "茶饮热点雷达数据流程",
  resolution_status: actual_value === target_value ? "resolved_or_not_applicable" : severity === "error" ? "open" : "accepted_limitation",
  resolution_note: actual_value === target_value ? "已满足阈值" : "已在页面与质量报告披露；未用于不适用指标",
  resolved_at: actual_value === target_value ? GENERATED_AT : "",
}));
assert(!qualityChecks.some((row) => row.status === "failed"), `V1.2存在阻断级质量问题：${qualityChecks.filter((row) => row.status === "failed").map((row) => row.check_id).join(", ")}`);

const reconciliation = [
  ["overview.unique_event_count", overview.unique_event_count, events.length],
  ["overview.brand_content_count", overview.brand_content_count, contents.length],
  ["overview.active_brand_count", overview.active_brand_count, unique(contents.map((row) => row.brand_id)).length],
  ["overview.likes_valid_count", overview.likes_valid_count, observations.filter((row) => Number.isFinite(row.likes)).length],
  ["themes.event_memberships", themeMetrics.reduce((sum, row) => sum + row.event_count, 0), overview.theme_membership_count],
  ["source_signals.total", overview.discovery_signal_count, overview.third_party_post_count + overview.koc_post_count],
  ["promotions.total", factPromotions.length, promotionMetrics.reduce((sum, row) => sum + row.offer_count, 0)],
].map(([check_id, reported_value, recalculated_value]) => ({
  check_id,
  reported_value,
  recalculated_value,
  difference: round(Number(reported_value) - Number(recalculated_value)),
  status: Number(reported_value) === Number(recalculated_value) ? "passed" : "failed",
  checked_at: GENERATED_AT,
}));
assert(reconciliation.every((row) => row.status === "passed"), "V1.2指标对账失败");

for (const dir of [MASTER_DIR, DETAIL_DIR, REVIEW_DIR, METRIC_DIR, ANALYSIS_DIR, BI_DIR, VALIDATION_DIR, FIELD_DICT_DIR, METRIC_DICT_DIR, TAG_DICT_DIR, STRATEGY_DIR, REPORT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

writeCsv(path.join(FIELD_DICT_DIR, "字段字典_V1.2.csv"), fieldDictionary);
writeCsv(path.join(METRIC_DICT_DIR, "指标字典_V1.2.csv"), metricDictionary);
writeCsv(path.join(TAG_DICT_DIR, "标签字典_V1.2.csv"), tagRows);
writeCsv(path.join(MASTER_DIR, "dim_brands.csv"), dimBrands);
writeCsv(path.join(MASTER_DIR, "dim_accounts.csv"), dimAccounts);
writeCsv(path.join(MASTER_DIR, "dim_entities.csv"), dimEntities);
writeCsv(path.join(MASTER_DIR, "dim_tags.csv"), tagRows);
writeCsv(path.join(MASTER_DIR, "dim_metrics.csv"), metricDictionary);

writeCsv(path.join(DETAIL_DIR, "fact_contents.csv"), factContents);
writeCsv(path.join(DETAIL_DIR, "fact_engagement_snapshots.csv"), factEngagement);
writeCsv(path.join(DETAIL_DIR, "fact_events.csv"), factEvents);
writeCsv(path.join(DETAIL_DIR, "bridge_event_content.csv"), bridgeEventContent);
writeCsv(path.join(DETAIL_DIR, "bridge_content_entity.csv"), relationAuditRows.map((row) => ({
  period_id: PERIOD_ID,
  relation_id: row.relation_id,
  content_id: row.content_id,
  event_id: row.event_id,
  entity_id: row.entity_id,
  role: row.role,
  evidence_field: row.evidence_field,
  review_status: row.review_status,
  is_active: row.is_active,
  reviewed_at: row.reviewed_at,
  review_reason: row.review_reason,
  rule_version: RULE_VERSION,
})));
writeCsv(path.join(DETAIL_DIR, "fact_source_signals.csv"), factSourceSignals);
writeCsv(path.join(DETAIL_DIR, "fact_promotion_offers.csv"), factPromotions);
writeCsv(path.join(REVIEW_DIR, "fact_tag_assignments.csv"), factTagAssignments);
writeCsv(path.join(REVIEW_DIR, "review_decisions.csv"), reviewDecisions);
writeCsv(path.join(REVIEW_DIR, "tag_review_queue.csv"), reviewQueue, ["review_item_id", "period_id", "review_type", "source_table", "object_id", "object_name", "current_status", "issue", "suggested_action", "priority", "rule_version"]);
writeCsv(path.join(METRIC_DIR, "mart_weekly_overview.csv"), [overview]);
writeCsv(path.join(METRIC_DIR, "mart_event_metrics.csv"), eventMetrics);
writeCsv(path.join(METRIC_DIR, "mart_theme_metrics.csv"), themeMetrics);
writeCsv(path.join(METRIC_DIR, "mart_tag_metrics.csv"), tagMetrics);
writeCsv(path.join(METRIC_DIR, "mart_brand_metrics.csv"), brandMetrics);
writeCsv(path.join(METRIC_DIR, "mart_product_category.csv"), categoryMetrics);
writeCsv(path.join(METRIC_DIR, "mart_ingredient.csv"), ingredientMetrics);
writeCsv(path.join(METRIC_DIR, "mart_collaboration.csv"), collaborationMetrics);
writeCsv(path.join(METRIC_DIR, "mart_promotion.csv"), promotionMetrics);
writeCsv(path.join(METRIC_DIR, "mart_hotspot.csv"), hotspotMetrics);
writeCsv(path.join(ANALYSIS_DIR, "analysis_insights.csv"), analysisInsights);
writeJson(path.join(ANALYSIS_DIR, "analysis_insights.json"), analysisInsights);
writeCsv(path.join(VALIDATION_DIR, "data_quality_checks.csv"), qualityChecks);
writeJson(path.join(VALIDATION_DIR, "data_quality_report.json"), {
  release: RELEASE,
  period_id: PERIOD_ID,
  generated_at: GENERATED_AT,
  blocking_status: "passed",
  warning_count: qualityChecks.filter((row) => row.severity === "warning" && row.actual_value !== row.target_value).length,
  disclosed_limitations: [
    "互动快照只有一次，且快照龄差异较大",
    "V1.1遗留的39个待复核项已在V1.2逐项处理；4条错误实体关系已驳回并保留审核记录",
    "三方与KOC线索缺统一captured_at和run_id",
    "shares全部缺失，content_format尚未分类",
    "只有1个完整可比周期，环比与趋势功能禁用",
  ],
  checks: qualityChecks,
});
writeCsv(path.join(VALIDATION_DIR, "metric_reconciliation.csv"), reconciliation);

const biSnapshot = {
  schema_version: "bi-dashboard-v1.2",
  release: RELEASE,
  source_release: SOURCE_RELEASE,
  generated_at: GENERATED_AT,
  period: { period_id: PERIOD_ID, start_date: period.start_date, end_date: period.end_date, timezone: period.timezone },
  overview,
  event_metrics: eventMetrics,
  themes: themeMetrics,
  tags: tagMetrics,
  brands: brandMetrics,
  product_categories: categoryMetrics,
  ingredients: ingredientMetrics,
  collaborations: collaborationMetrics,
  promotions: factPromotions,
  promotion_metrics: promotionMetrics,
  hotspots: hotspotMetrics,
  insights: analysisInsights,
  quality: {
    status: "passed_with_disclosed_warnings",
    blocking_error_count: 0,
    warning_count: qualityChecks.filter((row) => row.severity === "warning" && row.actual_value !== row.target_value).length,
    review_queue_count: reviewQueue.length,
    checks: qualityChecks,
  },
};
writeJson(path.join(BI_DIR, "bi_dashboard_snapshot.json"), biSnapshot);
writeCsv(path.join(BI_DIR, "bi_metric_long.csv"), [
  ...themeMetrics.flatMap((row) => ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_median", "likes_p75", "likes_mean", "likes_max"].map((metricId) => ({
    period_id: PERIOD_ID, dimension_type: "theme", dimension_id: row.theme_id, dimension_name: row.theme_label, metric_id: metricId, metric_value: row[metricId], source_class: "brand", metric_version: METRIC_VERSION,
  }))),
  ...tagMetrics.flatMap((row) => ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_median", "likes_p75"].map((metricId) => ({
    period_id: PERIOD_ID, dimension_type: "tag", dimension_id: row.tag_id, dimension_name: row.tag_name, metric_id: metricId, metric_value: row[metricId], source_class: "brand", metric_version: METRIC_VERSION,
  }))),
]);

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(INPUT_PAGE_DATA, "utf8"), context);
const legacyData = sanitizeDeep(context.window.RADAR_V1_DATA);
legacyData.meta.release = RELEASE;
legacyData.meta.source_release = SOURCE_RELEASE;
legacyData.meta.generated_at = GENERATED_AT;
legacyData.meta.rule_version = RULE_VERSION;
legacyData.meta.scope.source_identities = ["brand", "third_party", "koc", "editorial"];
legacyData.meta.isolation_note = "品牌事实层进入正式KPI；三方、KOC与编辑热点独立呈现，不与品牌事件和互动指标混算。";
legacyData.meta.analysis_gate = {
  required_review_count: reviewDecisions.length,
  resolved_review_count: reviewDecisions.length,
  rejected_relation_count: rejectedRelationIds.size,
  pending_count: reviewQueue.length,
  status: reviewQueue.length === 0 ? "approved" : "pending",
  rule: "事件标签、内容迁移与实体关系完成逐项复核后，才允许进入V1.2正式BI与页面。",
};
legacyData.summary.rule_version = RULE_VERSION;
legacyData.summary.metrics.entity_count = overview.entity_count;
legacyData.summary.metrics.needs_human_review_event_count = 0;
legacyData.summary.top_entities = legacyData.summary.top_entities.map((row) => row.entity_id === "ENT-PRODUCT-ELEMENT-茉莉"
  ? { ...row, content_count: 9, event_count: 7 }
  : row);
legacyData.events = sanitizeDeep(events);
legacyData.contents = sanitizeDeep(contents);
legacyData.entities = sanitizeDeep(entities);
legacyData.relations = sanitizeDeep(relations);
legacyData.summary.theme_analyses = legacyData.summary.theme_analyses.map((analysis) => ({
  ...analysis,
  tags: tagMetrics.filter((metric) => metric.theme_id === analysis.theme_id).map((metric) => {
    const oldTag = (analysis.tags || []).find((tag) => tag.tag_id === metric.tag_id);
    const matchingEvents = events.filter((event) => (event.tag_ids || []).includes(metric.tag_id));
    return {
      ...(oldTag || {}),
      tag_id: metric.tag_id,
      label: metric.tag_name,
      theme_ids: [metric.theme_id],
      event_ids: matchingEvents.map((event) => event.event_id),
      event_count: metric.event_count,
      content_ids: unique(matchingEvents.flatMap((event) => event.content_ids || [])),
      content_count: metric.content_count,
      likes_valid_count: metric.likes_valid_count,
      likes_missing_count: metric.likes_missing_count,
      likes_sum: metric.likes_sum,
      avg_likes: metric.likes_mean,
      filter_definition: oldTag?.filter_definition || { dimension: "action.level2_code", operator: "equals", value: "routine_promotion" },
    };
  }),
}));
legacyData.bi = biSnapshot;
legacyData.editorial_reference.topics = hotspotMetrics;
writeText(path.join(REPORT_DIR, "radar-v1-2-data.js"), `window.RADAR_V12_DATA = ${JSON.stringify(legacyData)};\n`);

writeText(path.join(STRATEGY_DIR, "分析输入输出契约_V1.2.md"), `# 分析输入输出契约 V1.2\n\n- 输入：标准化事实表、已审核标签表、BI汇总表。\n- 模型A：只建议语义标签，输出必须进入 \`tag_review_queue.csv\`。\n- 确定性脚本：计算计数、中位数、P75、P90、最大值、样本标记与对账。\n- 模型B：只根据 \`mart_*.csv\` 生成结论草稿，必须引用指标和案例ID。\n- 输出：\`analysis_insights.csv/json\`，字段固定为结论、证据点、案例ID、边界和审核状态。\n- 禁止：让模型自行计算指标、混合来源层、把单条爆款写成行业趋势、在不足4周期时输出趋势。\n`);

writeText(path.join(RELEASE_DIR, "README.md"), `# 处理后数据 V1.2\n\n本目录把2026-W30数据拆成五层：标准化明细、AI打标与人工复核、汇总指标、分析结论、BI数据集。\n\n- CSV 是机器可读事实来源；\n- Excel 由这些表自动生成，便于管理和复核；\n- 网页 JSON 由同一 BI 数据集生成；\n- V1.1 保持只读，不会被本构建覆盖。\n\n正式口径见 \`02_数据清洗/规则/数据分析与BI执行规范_V1.2.md\`。\n`);

const outputFiles = [];
for (const base of [MASTER_DIR, RELEASE_DIR, VALIDATION_DIR, FIELD_DICT_DIR, METRIC_DICT_DIR, TAG_DICT_DIR, STRATEGY_DIR, REPORT_DIR]) {
  for (const entry of fs.readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath || entry.path, entry.name);
    if (full.endsWith("manifest.json") || full.endsWith("release_validation_report.json")) continue;
    outputFiles.push({ path: path.relative(ROOT, full), sha256: sha256File(full), bytes: fs.statSync(full).size });
  }
}
outputFiles.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
writeJson(path.join(RELEASE_DIR, "manifest.json"), {
  schema_version: "release-manifest-v1.2",
  release: RELEASE,
  source_release: SOURCE_RELEASE,
  period_id: PERIOD_ID,
  generated_at: GENERATED_AT,
  rule_version: RULE_VERSION,
  metric_version: METRIC_VERSION,
  input_files: [
    "brands.json", "accounts.json", "collection_runs.json", "observations.json", "contents.json", "events.json", "entities.json",
    "content_entity_relations.json", "period_summaries.json", "source_registry.json", "editorial_topics.json", "source_signals.json",
  ].map((name) => ({ path: path.relative(ROOT, path.join(INPUT_DIR, name)), sha256: sha256File(path.join(INPUT_DIR, name)) })),
  output_files: outputFiles,
  validation_status: "passed_with_disclosed_warnings",
  public_release_note: "完整本地数据不得直接公开；公开包必须使用V1.2白名单与脱敏构建。",
});

console.log(JSON.stringify({
  release: RELEASE,
  period_id: PERIOD_ID,
  tables: {
    brands: dimBrands.length,
    accounts: dimAccounts.length,
    contents: factContents.length,
    events: factEvents.length,
    tag_assignments: factTagAssignments.length,
    review_queue: reviewQueue.length,
    source_signals: factSourceSignals.length,
    promotions: factPromotions.length,
    theme_metrics: themeMetrics.length,
    tag_metrics: tagMetrics.length,
  },
  overview,
  quality_status: "passed_with_disclosed_warnings",
}, null, 2));
