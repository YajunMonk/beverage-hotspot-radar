import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const V11_DIR = path.join(ROOT, "02_数据清洗/处理后数据/V1.1");
const MASTER_DIR = path.join(ROOT, "02_数据清洗/处理后数据/主数据");
const RELEASE_DIR = path.join(ROOT, "02_数据清洗/处理后数据/V1.2");
const SNAPSHOT_DIR = path.join(RELEASE_DIR, "周期快照/2026-W30");
const DETAIL_DIR = path.join(SNAPSHOT_DIR, "01_标准化明细");
const REVIEW_DIR = path.join(SNAPSHOT_DIR, "02_AI打标与人工复核");
const METRIC_DIR = path.join(SNAPSHOT_DIR, "03_汇总指标");
const ANALYSIS_DIR = path.join(SNAPSHOT_DIR, "04_分析结论");
const BI_DIR = path.join(SNAPSHOT_DIR, "05_BI数据集");
const PAGE_DATA_FILE = path.join(ROOT, "03_网页呈现/V1.2/radar-v1-2-data.js");
const MANIFEST_FILE = path.join(RELEASE_DIR, "manifest.json");
const VALIDATION_REPORT_FILE = path.join(ROOT, "02_数据清洗/校验记录/2026-W30/V1.2/release_validation_report.json");

const RELEASE = "V1.2";
const PERIOD_ID = "2026-W30";
const RULE_VERSION = "bi-tag-rule-v1.2";
const METRIC_VERSION = "bi-metric-v1.2";
const EPHEMERAL_URL_PARAMETER = /[?&](?:xsec_token|xsec_source|m_source)=/i;
const V12_ADDITIONAL_THEME_TAGS = [{ theme_id: "product_action", tag_id: "product-routine-promotion" }];
const V12_REJECTED_RELATION_IDS = [
  "REL-049687EA159BAE",
  "REL-E8A347D7EFFB99",
  "REL-B5E99DED232D08",
  "REL-92E074693CDF28",
];

// These hashes anchor the V1.1 inputs used to create V1.2. Updating the V1.2
// manifest cannot silently legitimize a changed historical input.
const V11_IMMUTABLE_HASHES = {
  "brands.json": "086227428b97f1a898f7a9ed8a1e470efb5035cfa40cac506893fbc9185737d3",
  "accounts.json": "4080e54b2a897ca893e7d9dc2f39041ea5ebaae0faa399537ec280754c286a02",
  "collection_runs.json": "fba3e4209552bb0fbd1386ddd25ec1cffec6de958dddaf355fb437b1d6968985",
  "observations.json": "a34b4b3dcc056ddb5cabbb5320920c037109bfb8efbf0a02133b7c53e2337825",
  "contents.json": "ecc8b64686a2759cdb347cf50c8371066d1d63a050e0153c02a3987a9c82ca29",
  "events.json": "5b48781f6ef2f1b8a2dc485468a68aebf5e32c3c76be778b66b427d392d6fd5c",
  "entities.json": "a1bf9529cbb132ef3e9dfd0755eaa3a6ea13d5ab9c10999f44ebc5e6c0e6eba9",
  "content_entity_relations.json": "6b245a559bc82f9f4105f400563cae13201b23574d58f07cb1048316d3564c26",
  "period_summaries.json": "e72529c577820cd0159e3c888bef762883e30571998bfbf922672a2fa923d5cc",
  "source_registry.json": "a88dcf28c03c1ad485a662fca8f47afb8ef5ec0e53b66b56642d27e8adbc0f2a",
  "editorial_topics.json": "7765e0fdd18d9da6ba8ca1294e49acf71c9a9a5ca9caa5cf5b97b8d3eb4db718",
  "source_signals.json": "c74b844f770998da09e641c845356fbe5da76ad40212bce60efde48e71bd9ad1",
};

const checks = [];

function addCheck(id, category, passed, message, { expected, actual, details } = {}) {
  const result = { id, category, status: passed ? "passed" : "failed", message };
  if (expected !== undefined) result.expected = expected;
  if (actual !== undefined) result.actual = actual;
  if (details !== undefined) result.details = details;
  checks.push(result);
  return passed;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseCsv(text, sourceName = "CSV") {
  const input = text.replace(/^\ufeff/, "");
  const matrix = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      matrix.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`${sourceName} 存在未闭合引号`);
  if (field !== "" || row.length) {
    row.push(field.replace(/\r$/, ""));
    matrix.push(row);
  }
  while (matrix.length && matrix.at(-1).every((value) => value === "")) matrix.pop();
  if (!matrix.length) throw new Error(`${sourceName} 为空`);
  const headers = matrix.shift();
  if (new Set(headers).size !== headers.length) throw new Error(`${sourceName} 存在重复列名`);
  return matrix.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`${sourceName} 第${rowIndex + 2}行列数${values.length}，应为${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
  });
}

function readCsv(file) {
  return parseCsv(fs.readFileSync(file, "utf8"), path.relative(ROOT, file));
}

function splitMulti(value) {
  return [...new Set(String(value || "").split("｜").map((item) => item.trim()).filter(Boolean))];
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function numeric(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return round(sorted[low] + (sorted[high] - sorted[low]) * (index - low));
}

function valuesEqual(left, right) {
  if ((left === "" || left === null || left === undefined) && (right === "" || right === null || right === undefined)) return true;
  const leftBoolean = booleanValue(left);
  const rightBoolean = booleanValue(right);
  if (typeof leftBoolean === "boolean" || typeof rightBoolean === "boolean") return leftBoolean === rightBoolean;
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber !== null && rightNumber !== null) return Math.abs(leftNumber - rightNumber) <= 1e-9;
  return String(left) === String(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function keyOf(row, fields) {
  return fields.map((field) => String(row?.[field] ?? "")).join("|");
}

function checkPrimaryKey(name, rows, fields) {
  const empty = [];
  const duplicates = [];
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const key = keyOf(rows[index], fields);
    if (fields.some((field) => rows[index]?.[field] === "" || rows[index]?.[field] === null || rows[index]?.[field] === undefined)) {
      empty.push({ row: index + 2, key });
    }
    if (seen.has(key)) duplicates.push({ row: index + 2, key });
    seen.add(key);
  }
  addCheck(
    `pk.${name}`,
    "primary_key",
    empty.length === 0 && duplicates.length === 0,
    `${name} 主键 ${fields.join("+")} 非空且唯一`,
    { expected: { empty: 0, duplicates: 0 }, actual: { empty: empty.length, duplicates: duplicates.length }, details: [...empty, ...duplicates].slice(0, 10) },
  );
}

function checkRowCount(name, rows, expected) {
  addCheck(`rows.${name}`, "row_count", rows.length === expected, `${name} 关键行数符合口径`, { expected, actual: rows.length });
}

function checkForeignKey(id, childRows, childField, parentValues, { allowBlank = false, transform = (value) => [value] } = {}) {
  const missing = [];
  for (let index = 0; index < childRows.length; index += 1) {
    const raw = childRows[index]?.[childField];
    if ((raw === "" || raw === null || raw === undefined) && allowBlank) continue;
    for (const value of transform(raw)) {
      if (!parentValues.has(value)) missing.push({ row: index + 2, field: childField, value });
    }
  }
  addCheck(id, "foreign_key", missing.length === 0, `${childField} 外键均可回溯`, { expected: 0, actual: missing.length, details: missing.slice(0, 10) });
}

function compareRowFields(actual, expected, fields) {
  return fields.filter((field) => !valuesEqual(actual?.[field], expected?.[field])).map((field) => ({ field, expected: expected?.[field] ?? null, actual: actual?.[field] ?? null }));
}

function compareTables(id, category, actualRows, expectedRows, keyFields, fields) {
  const actualMap = new Map(actualRows.map((row) => [keyOf(row, keyFields), row]));
  const expectedMap = new Map(expectedRows.map((row) => [keyOf(row, keyFields), row]));
  const differences = [];
  for (const [key, expected] of expectedMap) {
    const actual = actualMap.get(key);
    if (!actual) {
      differences.push({ key, issue: "missing_row" });
      continue;
    }
    const mismatches = compareRowFields(actual, expected, fields);
    if (mismatches.length) differences.push({ key, issue: "field_mismatch", mismatches });
  }
  for (const key of actualMap.keys()) {
    if (!expectedMap.has(key)) differences.push({ key, issue: "unexpected_row" });
  }
  addCheck(id, category, differences.length === 0, `${id} 行与关键字段一致`, { expected: expectedRows.length, actual: actualRows.length, details: differences.slice(0, 10) });
}

function collectEphemeralUrls(value, location, issues) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectEphemeralUrls(child, `${location}[${index}]`, issues));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (typeof child === "string" && key.toLowerCase().includes("url") && EPHEMERAL_URL_PARAMETER.test(child)) {
      issues.push({ location: childLocation, value: child });
    } else {
      collectEphemeralUrls(child, childLocation, issues);
    }
  }
}

function engagementStats(contentIds, engagementByContent) {
  const ids = unique(contentIds);
  const rows = ids.map((contentId) => ({ contentId, row: engagementByContent.get(contentId) })).filter(({ row }) => row);
  const valid = rows.filter(({ row }) => numeric(row.likes) !== null);
  const likes = valid.map(({ row }) => numeric(row.likes));
  const ages = rows.map(({ row }) => numeric(row.snapshot_age_hours)).filter(Number.isFinite);
  const ordered = [...valid].sort((left, right) => numeric(right.row.likes) - numeric(left.row.likes) || left.contentId.localeCompare(right.contentId));
  return {
    content_count: ids.length,
    likes_valid_count: likes.length,
    likes_missing_count: ids.length - likes.length,
    likes_sum: likes.reduce((sum, value) => sum + value, 0),
    likes_mean: likes.length ? round(likes.reduce((sum, value) => sum + value, 0) / likes.length) : null,
    likes_median: quantile(likes, 0.5),
    likes_p75: quantile(likes, 0.75),
    likes_p90: quantile(likes, 0.9),
    likes_max: likes.length ? Math.max(...likes) : null,
    top_content_id: ordered[0]?.contentId || "",
    sample_flag: likes.length < 5 ? "small_sample" : "sufficient_for_descriptive_stats",
    snapshot_age_hours_min: ages.length ? Math.min(...ages) : null,
    snapshot_age_hours_median: quantile(ages, 0.5),
    snapshot_age_hours_max: ages.length ? Math.max(...ages) : null,
  };
}

function insideRoot(relativePath) {
  const resolved = path.resolve(ROOT, relativePath);
  return resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`);
}

function expectedDimAccountCount(accounts, sourceRegistry, sourceSignals) {
  const signalClassBySource = new Map((sourceSignals.signals || []).filter((row) => row.source_id).map((row) => [row.source_id, row.source_class]));
  const identities = [
    ...accounts.map((row) => `${row.account_name}|brand`),
    ...(sourceRegistry.sources || []).map((row) => `${row.account_name}|${signalClassBySource.get(row.source_id) || (row.source_type === "editorial_hotspot" ? "editorial" : "unassigned")}`),
  ];
  let count = accounts.length + (sourceRegistry.sources || []).length;
  for (const signal of sourceSignals.signals || []) {
    const identity = `${signal.source_name}|${signal.source_class}`;
    if (!signal.source_id && !identities.includes(identity)) {
      identities.push(identity);
      count += 1;
    }
  }
  return count;
}

function loadPageData(file) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { timeout: 2_000, codeGeneration: { strings: false, wasm: false } });
  if (!context.window.RADAR_V12_DATA || typeof context.window.RADAR_V12_DATA !== "object") {
    throw new Error("页面数据脚本未设置 window.RADAR_V12_DATA");
  }
  return context.window.RADAR_V12_DATA;
}

try {
  const manifest = readJson(MANIFEST_FILE);
  const brandsV11 = readJson(path.join(V11_DIR, "brands.json"));
  const accountsV11 = readJson(path.join(V11_DIR, "accounts.json"));
  const observationsV11 = readJson(path.join(V11_DIR, "observations.json"));
  const contentsV11 = readJson(path.join(V11_DIR, "contents.json"));
  const eventsV11 = readJson(path.join(V11_DIR, "events.json"));
  const entitiesV11 = readJson(path.join(V11_DIR, "entities.json"));
  const relationsV11 = readJson(path.join(V11_DIR, "content_entity_relations.json"));
  const periodV11 = readJson(path.join(V11_DIR, "period_summaries.json"))[0];
  const registryV11 = readJson(path.join(V11_DIR, "source_registry.json"));
  const editorialV11 = readJson(path.join(V11_DIR, "editorial_topics.json"));
  const signalsV11 = readJson(path.join(V11_DIR, "source_signals.json"));

  addCheck("manifest.release", "manifest", manifest.release === RELEASE && manifest.source_release === "V1.1", "manifest版本链正确", { expected: { release: RELEASE, source_release: "V1.1" }, actual: { release: manifest.release, source_release: manifest.source_release } });
  addCheck("manifest.period", "manifest", manifest.period_id === PERIOD_ID, "manifest周期正确", { expected: PERIOD_ID, actual: manifest.period_id });
  addCheck("manifest.versions", "manifest", manifest.rule_version === RULE_VERSION && manifest.metric_version === METRIC_VERSION, "manifest规则与指标版本正确", { expected: { rule_version: RULE_VERSION, metric_version: METRIC_VERSION }, actual: { rule_version: manifest.rule_version, metric_version: manifest.metric_version } });

  const manifestInputs = new Map((manifest.input_files || []).map((entry) => [path.basename(entry.path), entry]));
  const expectedInputNames = Object.keys(V11_IMMUTABLE_HASHES).sort();
  const actualInputNames = [...manifestInputs.keys()].sort();
  addCheck("v11.fingerprint_set", "source_immutability", stableJson(actualInputNames) === stableJson(expectedInputNames), "V1.1不可变输入文件集合完整", { expected: expectedInputNames, actual: actualInputNames });
  for (const [name, immutableHash] of Object.entries(V11_IMMUTABLE_HASHES)) {
    const file = path.join(V11_DIR, name);
    const currentHash = fs.existsSync(file) ? sha256File(file) : null;
    const manifestHash = manifestInputs.get(name)?.sha256 || null;
    addCheck(`v11.immutable.${name}`, "source_immutability", currentHash === immutableHash && manifestHash === immutableHash, `${name} 与冻结指纹及V1.2输入声明一致`, { expected: immutableHash, actual: { current: currentHash, manifest: manifestHash } });
  }

  const manifestPathIssues = [...(manifest.input_files || []), ...(manifest.output_files || [])].filter((entry) => !entry.path || !insideRoot(entry.path)).map((entry) => entry.path);
  addCheck("manifest.safe_paths", "manifest", manifestPathIssues.length === 0, "manifest仅引用项目目录内相对路径", { expected: 0, actual: manifestPathIssues.length, details: manifestPathIssues });
  const outputPaths = (manifest.output_files || []).map((entry) => entry.path);
  const duplicateOutputPaths = outputPaths.filter((value, index) => outputPaths.indexOf(value) !== index);
  addCheck("manifest.unique_outputs", "manifest", duplicateOutputPaths.length === 0, "manifest输出路径不重复", { expected: 0, actual: duplicateOutputPaths.length, details: unique(duplicateOutputPaths) });
  for (const entry of manifest.output_files || []) {
    const full = insideRoot(entry.path) ? path.resolve(ROOT, entry.path) : "";
    const exists = Boolean(full) && fs.existsSync(full) && fs.statSync(full).isFile();
    const currentHash = exists ? sha256File(full) : null;
    const currentBytes = exists ? fs.statSync(full).size : null;
    addCheck(`manifest.output.${entry.path}`, "manifest_hash", exists && currentHash === entry.sha256 && currentBytes === entry.bytes, `${entry.path} 文件哈希和字节数符合manifest`, { expected: { sha256: entry.sha256, bytes: entry.bytes }, actual: { sha256: currentHash, bytes: currentBytes } });
  }

  const tables = {
    dim_brands: readCsv(path.join(MASTER_DIR, "dim_brands.csv")),
    dim_accounts: readCsv(path.join(MASTER_DIR, "dim_accounts.csv")),
    dim_entities: readCsv(path.join(MASTER_DIR, "dim_entities.csv")),
    dim_tags: readCsv(path.join(MASTER_DIR, "dim_tags.csv")),
    dim_metrics: readCsv(path.join(MASTER_DIR, "dim_metrics.csv")),
    fact_contents: readCsv(path.join(DETAIL_DIR, "fact_contents.csv")),
    fact_engagement_snapshots: readCsv(path.join(DETAIL_DIR, "fact_engagement_snapshots.csv")),
    fact_events: readCsv(path.join(DETAIL_DIR, "fact_events.csv")),
    bridge_event_content: readCsv(path.join(DETAIL_DIR, "bridge_event_content.csv")),
    bridge_content_entity: readCsv(path.join(DETAIL_DIR, "bridge_content_entity.csv")),
    fact_source_signals: readCsv(path.join(DETAIL_DIR, "fact_source_signals.csv")),
    fact_promotion_offers: readCsv(path.join(DETAIL_DIR, "fact_promotion_offers.csv")),
    fact_tag_assignments: readCsv(path.join(REVIEW_DIR, "fact_tag_assignments.csv")),
    review_decisions: readCsv(path.join(REVIEW_DIR, "review_decisions.csv")),
    tag_review_queue: readCsv(path.join(REVIEW_DIR, "tag_review_queue.csv")),
    mart_weekly_overview: readCsv(path.join(METRIC_DIR, "mart_weekly_overview.csv")),
    mart_event_metrics: readCsv(path.join(METRIC_DIR, "mart_event_metrics.csv")),
    mart_theme_metrics: readCsv(path.join(METRIC_DIR, "mart_theme_metrics.csv")),
    mart_tag_metrics: readCsv(path.join(METRIC_DIR, "mart_tag_metrics.csv")),
    mart_brand_metrics: readCsv(path.join(METRIC_DIR, "mart_brand_metrics.csv")),
    mart_product_category: readCsv(path.join(METRIC_DIR, "mart_product_category.csv")),
    mart_ingredient: readCsv(path.join(METRIC_DIR, "mart_ingredient.csv")),
    mart_collaboration: readCsv(path.join(METRIC_DIR, "mart_collaboration.csv")),
    mart_promotion: readCsv(path.join(METRIC_DIR, "mart_promotion.csv")),
    mart_hotspot: readCsv(path.join(METRIC_DIR, "mart_hotspot.csv")),
    analysis_insights: readCsv(path.join(ANALYSIS_DIR, "analysis_insights.csv")),
    bi_metric_long: readCsv(path.join(BI_DIR, "bi_metric_long.csv")),
  };
  const analysisJson = readJson(path.join(ANALYSIS_DIR, "analysis_insights.json"));
  const bi = readJson(path.join(BI_DIR, "bi_dashboard_snapshot.json"));
  const pageData = loadPageData(PAGE_DATA_FILE);

  const categoryCodes = new Set(eventsV11.flatMap((event) => (event.product_categories || []).map((category) => `category-${category.level2_code}`)));
  const expectedTagIds = new Set([
    ...periodV11.theme_analyses.map((analysis) => `theme-${analysis.theme_id}`),
    ...periodV11.theme_analyses.flatMap((analysis) => analysis.tags.map((tag) => tag.tag_id)),
    ...V12_ADDITIONAL_THEME_TAGS.map((row) => row.tag_id),
    "promotion-buy-one-get-one", "promotion-coupon", "promotion-gift", "promotion-fixed-price", "promotion-pass-card",
    "source-brand", "source-third-party", "source-koc", "source-editorial",
    ...categoryCodes,
  ]);
  const expectedCounts = {
    dim_brands: brandsV11.length,
    dim_accounts: expectedDimAccountCount(accountsV11, registryV11, signalsV11),
    dim_entities: entitiesV11.length,
    dim_tags: expectedTagIds.size,
    dim_metrics: 20,
    fact_contents: contentsV11.length,
    fact_engagement_snapshots: observationsV11.length,
    fact_events: eventsV11.length,
    bridge_event_content: eventsV11.reduce((sum, event) => sum + unique(event.content_ids || []).length, 0),
    bridge_content_entity: relationsV11.length,
    fact_source_signals: (signalsV11.signals || []).length,
    fact_promotion_offers: numeric(tables.mart_weekly_overview[0]?.promotion_official_count) + numeric(tables.mart_weekly_overview[0]?.promotion_discovery_count),
    fact_tag_assignments: 162,
    review_decisions: 39,
    tag_review_queue: 0,
    mart_weekly_overview: 1,
    mart_event_metrics: 35,
    mart_theme_metrics: periodV11.theme_analyses.length,
    mart_tag_metrics: 25,
    mart_brand_metrics: brandsV11.length,
    mart_product_category: new Set(eventsV11.flatMap((event) => (event.product_categories || []).flatMap((category) => [`1|${category.level1_code}`, `2|${category.level2_code}`]))).size,
    mart_ingredient: entitiesV11.filter((entity) => entity.entity_type === "product_element").length,
    mart_collaboration: entitiesV11.filter((entity) => entity.entity_type === "collab_partner").length,
    mart_promotion: new Set(tables.fact_promotion_offers.map((row) => `${row.source_class}|${row.promotion_type}`)).size,
    mart_hotspot: (editorialV11.topics || []).length,
    analysis_insights: periodV11.theme_analyses.length + 4,
    bi_metric_long: 174,
  };
  for (const [name, expected] of Object.entries(expectedCounts)) checkRowCount(name, tables[name], expected);
  const actualFormalTagIds = tables.dim_tags.map((row) => row.tag_id).sort();
  const expectedFormalTagIds = [...expectedTagIds].sort();
  addCheck("tags.formal_dimension_set", "row_count", stableJson(actualFormalTagIds) === stableJson(expectedFormalTagIds), "dim_tags与V1.2确认后的正式标签集合完全一致", { expected: expectedFormalTagIds, actual: actualFormalTagIds });

  const primaryKeys = {
    dim_brands: ["brand_id"], dim_accounts: ["account_key"], dim_entities: ["entity_id"], dim_tags: ["tag_id"], dim_metrics: ["metric_id"],
    fact_contents: ["content_id"], fact_engagement_snapshots: ["observation_id"], fact_events: ["event_id"], bridge_event_content: ["event_content_key"], bridge_content_entity: ["relation_id"],
    fact_source_signals: ["signal_id"], fact_promotion_offers: ["promotion_id"], fact_tag_assignments: ["assignment_id"], review_decisions: ["review_item_id"], tag_review_queue: ["review_item_id"],
    mart_weekly_overview: ["period_id"], mart_event_metrics: ["period_id", "event_id"], mart_theme_metrics: ["period_id", "theme_id"], mart_tag_metrics: ["period_id", "theme_id", "tag_id"],
    mart_brand_metrics: ["period_id", "brand_id"], mart_product_category: ["period_id", "category_level", "category_code"],
    mart_ingredient: ["period_id", "entity_id"], mart_collaboration: ["period_id", "entity_id"], mart_promotion: ["period_id", "source_class", "promotion_type"],
    mart_hotspot: ["report_period_id", "topic_id"], analysis_insights: ["insight_id"], bi_metric_long: ["period_id", "dimension_type", "dimension_id", "metric_id"],
  };
  for (const [name, fields] of Object.entries(primaryKeys)) checkPrimaryKey(name, tables[name], fields);

  const brandIds = new Set(tables.dim_brands.map((row) => row.brand_id));
  const platformAccountIds = new Set(tables.dim_accounts.map((row) => row.platform_account_id).filter(Boolean));
  const accountKeysAndSources = new Set(tables.dim_accounts.flatMap((row) => [row.account_key, row.source_id]).filter(Boolean));
  const contentIds = new Set(tables.fact_contents.map((row) => row.content_id));
  const eventIds = new Set(tables.fact_events.map((row) => row.event_id));
  const entityIds = new Set(tables.dim_entities.map((row) => row.entity_id));
  const tagIds = new Set(tables.dim_tags.map((row) => row.tag_id));
  const signalIds = new Set(tables.fact_source_signals.map((row) => row.signal_id));
  const relationIdsV11 = new Set(relationsV11.map((row) => row.relation_id));
  checkForeignKey("fk.dim_brands.account", tables.dim_brands, "official_account_id", platformAccountIds);
  checkForeignKey("fk.fact_contents.brand", tables.fact_contents, "brand_id", brandIds);
  checkForeignKey("fk.fact_contents.account", tables.fact_contents, "account_id", platformAccountIds);
  checkForeignKey("fk.fact_contents.primary_event", tables.fact_contents, "primary_event_id", eventIds);
  checkForeignKey("fk.fact_contents.events", tables.fact_contents, "event_ids", eventIds, { transform: splitMulti });
  checkForeignKey("fk.engagement.content", tables.fact_engagement_snapshots, "content_id", contentIds);
  checkForeignKey("fk.events.brand", tables.fact_events, "primary_brand_id", brandIds);
  checkForeignKey("fk.bridge.event", tables.bridge_event_content, "event_id", eventIds);
  checkForeignKey("fk.bridge.content", tables.bridge_event_content, "content_id", contentIds);
  checkForeignKey("fk.bridge.brand", tables.bridge_event_content, "primary_brand_id", brandIds);
  checkForeignKey("fk.content_entity.content", tables.bridge_content_entity, "content_id", contentIds);
  checkForeignKey("fk.content_entity.event", tables.bridge_content_entity, "event_id", eventIds);
  checkForeignKey("fk.content_entity.entity", tables.bridge_content_entity, "entity_id", entityIds);
  checkForeignKey("fk.source_signals.source", tables.fact_source_signals, "source_id", accountKeysAndSources, { allowBlank: true });
  const outOfPanelSignalBrands = tables.fact_source_signals.filter((row) => row.primary_brand_id && !brandIds.has(row.primary_brand_id));
  const invalidOutOfPanelSignalBrands = outOfPanelSignalBrands.filter((row) => booleanValue(row.included_in_brand_kpi) !== false || !["third_party", "koc"].includes(row.analysis_source_class));
  addCheck("fk.source_signals.brand_scope", "foreign_key", invalidOutOfPanelSignalBrands.length === 0, "监测池外品牌仅可出现在不计入KPI的发现层", { expected: 0, actual: invalidOutOfPanelSignalBrands.length, details: { out_of_panel_reference_count: outOfPanelSignalBrands.length, invalid_rows: invalidOutOfPanelSignalBrands.slice(0, 10).map((row) => ({ signal_id: row.signal_id, primary_brand_id: row.primary_brand_id, source_class: row.analysis_source_class, included_in_brand_kpi: row.included_in_brand_kpi })) } });
  checkForeignKey("fk.promotions.brand", tables.fact_promotion_offers, "primary_brand_id", brandIds, { allowBlank: true });
  const promotionReferenceIssues = tables.fact_promotion_offers.filter((row) => row.source_class === "brand" ? !contentIds.has(row.content_or_signal_id) : !signalIds.has(row.content_or_signal_id));
  addCheck("fk.promotions.evidence", "foreign_key", promotionReferenceIssues.length === 0, "促销证据回指品牌内容或发现信号", { expected: 0, actual: promotionReferenceIssues.length, details: promotionReferenceIssues.slice(0, 10).map((row) => ({ promotion_id: row.promotion_id, evidence_id: row.content_or_signal_id })) });
  checkForeignKey("fk.tag_assignments.tag", tables.fact_tag_assignments, "tag_id", tagIds);
  const assignmentObjectIssues = tables.fact_tag_assignments.filter((row) => row.object_type !== "event" || !eventIds.has(row.object_id));
  addCheck("fk.tag_assignments.object", "foreign_key", assignmentObjectIssues.length === 0, "标签判定对象均回指事件事实", { expected: 0, actual: assignmentObjectIssues.length, details: assignmentObjectIssues.slice(0, 10).map((row) => ({ assignment_id: row.assignment_id, object_type: row.object_type, object_id: row.object_id })) });
  const reviewReferenceIssues = tables.tag_review_queue.filter((row) => {
    if (row.source_table === "fact_events") return !eventIds.has(row.object_id);
    if (row.source_table === "fact_contents") return !contentIds.has(row.object_id);
    if (row.source_table === "content_entity_relations") return !relationIdsV11.has(row.object_id);
    return true;
  });
  addCheck("fk.review_queue.object", "foreign_key", reviewReferenceIssues.length === 0, "复核队列对象均可回溯", { expected: 0, actual: reviewReferenceIssues.length, details: reviewReferenceIssues.slice(0, 10).map((row) => ({ review_item_id: row.review_item_id, source_table: row.source_table, object_id: row.object_id })) });
  const decisionReferenceIssues = tables.review_decisions.filter((row) => {
    if (row.source_table === "fact_events") return !eventIds.has(row.object_id);
    if (row.source_table === "fact_contents") return !contentIds.has(row.object_id);
    if (row.source_table === "content_entity_relations") return !relationIdsV11.has(row.object_id);
    return true;
  });
  addCheck("fk.review_decisions.object", "foreign_key", decisionReferenceIssues.length === 0, "复核决策对象均可回溯到正式事实或冻结关系", { expected: 0, actual: decisionReferenceIssues.length, details: decisionReferenceIssues.slice(0, 10).map((row) => ({ review_item_id: row.review_item_id, source_table: row.source_table, object_id: row.object_id })) });
  checkForeignKey("fk.mart_events.event", tables.mart_event_metrics, "event_id", eventIds);
  checkForeignKey("fk.mart_events.brand", tables.mart_event_metrics, "primary_brand_id", brandIds);
  checkForeignKey("fk.mart_brands.brand", tables.mart_brand_metrics, "brand_id", brandIds);
  checkForeignKey("fk.mart_ingredient.entity", tables.mart_ingredient, "entity_id", entityIds);
  checkForeignKey("fk.mart_collaboration.entity", tables.mart_collaboration, "entity_id", entityIds);
  checkForeignKey("fk.mart_tags.tag", tables.mart_tag_metrics, "tag_id", tagIds);
  checkForeignKey("fk.hotspots.source", tables.mart_hotspot, "source_id", accountKeysAndSources);

  const duplicateSnapshotContentIds = tables.fact_engagement_snapshots.map((row) => row.content_id).filter((value, index, array) => array.indexOf(value) !== index);
  addCheck("grain.engagement_one_snapshot_per_content", "grain", duplicateSnapshotContentIds.length === 0 && tables.fact_engagement_snapshots.length === tables.fact_contents.length, "本周期每篇品牌内容恰有一条互动快照", { expected: { duplicates: 0, rows: tables.fact_contents.length }, actual: { duplicates: duplicateSnapshotContentIds.length, rows: tables.fact_engagement_snapshots.length }, details: unique(duplicateSnapshotContentIds).slice(0, 10) });

  const expectedReviewIds = [
    ...eventsV11.filter((row) => row.tag_review_status !== "codex_reviewed").map((row) => `REVIEW-EVENT-${row.event_id}`),
    ...contentsV11.filter((row) => row.migration_status === "needs_human_review").map((row) => `REVIEW-CONTENT-${row.content_id}`),
    ...relationsV11.filter((row) => row.review_status !== "codex_reviewed").map((row) => `REVIEW-RELATION-${row.relation_id}`),
  ].sort();
  const actualReviewIds = tables.review_decisions.map((row) => row.review_item_id).sort();
  addCheck("review.decisions.coverage", "review_resolution", stableJson(actualReviewIds) === stableJson(expectedReviewIds), "原39个待复核项均有且只有一条正式决策", { expected: expectedReviewIds, actual: actualReviewIds });
  const reviewTypeCounts = Object.fromEntries(["event_tag", "content_migration", "content_entity_relation"].map((type) => [type, tables.review_decisions.filter((row) => row.review_type === type).length]));
  const decisionStatusCounts = Object.fromEntries(["approved_v1.2", "rejected_v1.2"].map((status) => [status, tables.review_decisions.filter((row) => row.decision_status === status).length]));
  const malformedDecisions = tables.review_decisions.filter((row) => row.previous_status !== "needs_human_review" || !["approved_v1.2", "rejected_v1.2"].includes(row.decision_status) || !row.correction_note || !row.evidence_basis || !row.reviewed_at);
  addCheck("review.decisions.outcomes", "review_resolution", stableJson(reviewTypeCounts) === stableJson({ event_tag: 9, content_migration: 11, content_entity_relation: 19 }) && stableJson(decisionStatusCounts) === stableJson({ "approved_v1.2": 35, "rejected_v1.2": 4 }) && malformedDecisions.length === 0, "39条决策类型、结果和审计字段完整", { expected: { types: { event_tag: 9, content_migration: 11, content_entity_relation: 19 }, outcomes: { "approved_v1.2": 35, "rejected_v1.2": 4 }, malformed: 0 }, actual: { types: reviewTypeCounts, outcomes: decisionStatusCounts, malformed: malformedDecisions.length }, details: malformedDecisions.slice(0, 10).map((row) => row.review_item_id) });
  const rejectedDecisionIds = tables.review_decisions.filter((row) => row.decision_status === "rejected_v1.2").map((row) => row.object_id).sort();
  const rejectedRelationRows = tables.bridge_content_entity.filter((row) => row.review_status === "rejected_v1.2" || booleanValue(row.is_active) === false);
  const rejectedRelationIds = rejectedRelationRows.map((row) => row.relation_id).sort();
  const rejectedRelationMalformed = rejectedRelationRows.filter((row) => row.review_status !== "rejected_v1.2" || booleanValue(row.is_active) !== false || !row.review_reason || !row.reviewed_at);
  addCheck("review.rejected_relations", "review_resolution", stableJson(rejectedDecisionIds) === stableJson([...V12_REJECTED_RELATION_IDS].sort()) && stableJson(rejectedRelationIds) === stableJson([...V12_REJECTED_RELATION_IDS].sort()) && rejectedRelationMalformed.length === 0, "4条被驳回关系在决策表和关系桥表中一致留痕并停用", { expected: [...V12_REJECTED_RELATION_IDS].sort(), actual: { decisions: rejectedDecisionIds, relations: rejectedRelationIds, malformed: rejectedRelationMalformed.length } });
  const unresolvedFacts = {
    queue: tables.tag_review_queue.length,
    events: tables.fact_events.filter((row) => !String(row.tag_review_status).startsWith("codex_reviewed")).length,
    contents: tables.fact_contents.filter((row) => row.review_status !== "approved").length,
    assignments: tables.fact_tag_assignments.filter((row) => row.review_status !== "approved").length,
    relations: tables.bridge_content_entity.filter((row) => String(row.review_status).includes("needs") || String(row.review_status).includes("pending")).length,
  };
  addCheck("review.zero_unresolved", "review_resolution", Object.values(unresolvedFacts).every((value) => value === 0), "待复核队列及各正式事实层未决状态全部清零", { expected: { queue: 0, events: 0, contents: 0, assignments: 0, relations: 0 }, actual: unresolvedFacts });
  const overviewReviewActual = {
    approved_event_review_count: numeric(tables.mart_weekly_overview[0]?.approved_event_review_count),
    pending_event_review_count: numeric(tables.mart_weekly_overview[0]?.pending_event_review_count),
    review_completion_rate: numeric(tables.mart_weekly_overview[0]?.review_completion_rate),
    pending_content_review_count: numeric(tables.mart_weekly_overview[0]?.pending_content_review_count),
    pending_relation_review_count: numeric(tables.mart_weekly_overview[0]?.pending_relation_review_count),
    resolved_review_decision_count: numeric(tables.mart_weekly_overview[0]?.resolved_review_decision_count),
    rejected_relation_count: numeric(tables.mart_weekly_overview[0]?.rejected_relation_count),
  };
  const overviewReviewExpected = { approved_event_review_count: 35, pending_event_review_count: 0, review_completion_rate: 1, pending_content_review_count: 0, pending_relation_review_count: 0, resolved_review_decision_count: 39, rejected_relation_count: 4 };
  addCheck("review.overview", "review_resolution", stableJson(overviewReviewActual) === stableJson(overviewReviewExpected), "BI总览准确反映复核完成状态", { expected: overviewReviewExpected, actual: overviewReviewActual });
  const activeEntityRows = tables.dim_entities.filter((row) => row.status !== "inactive_rejected_v1.2");
  const inactiveEntityRows = tables.dim_entities.filter((row) => row.status === "inactive_rejected_v1.2");
  addCheck("entities.v12_active_count", "review_resolution", activeEntityRows.length === 74 && numeric(tables.mart_weekly_overview[0]?.entity_count) === 74 && inactiveEntityRows.length === 1 && inactiveEntityRows[0]?.entity_id === "ENT-PRODUCT-SERIES-喜茶苹果产品系列", "V1.2保留驳回实体审计行，但正式活跃实体口径为74", { expected: { active: 74, overview: 74, inactive_rejected: ["ENT-PRODUCT-SERIES-喜茶苹果产品系列"] }, actual: { active: activeEntityRows.length, overview: numeric(tables.mart_weekly_overview[0]?.entity_count), inactive_rejected: inactiveEntityRows.map((row) => row.entity_id) } });

  const sourceIsolationIssues = [];
  for (const [tableName, rows] of Object.entries({
    dim_brands: tables.dim_brands, fact_contents: tables.fact_contents, bridge_event_content: tables.bridge_event_content,
    fact_tag_assignments: tables.fact_tag_assignments, mart_weekly_overview: tables.mart_weekly_overview,
    mart_event_metrics: tables.mart_event_metrics, mart_theme_metrics: tables.mart_theme_metrics, mart_tag_metrics: tables.mart_tag_metrics,
    mart_brand_metrics: tables.mart_brand_metrics, mart_product_category: tables.mart_product_category,
    mart_ingredient: tables.mart_ingredient, mart_collaboration: tables.mart_collaboration,
  })) {
    rows.forEach((row, index) => {
      if (row.source_class !== "brand") sourceIsolationIssues.push({ table: tableName, row: index + 2, source_class: row.source_class });
    });
  }
  tables.fact_source_signals.forEach((row, index) => {
    if (!["third_party", "koc"].includes(row.analysis_source_class) || booleanValue(row.included_in_brand_kpi) !== false) {
      sourceIsolationIssues.push({ table: "fact_source_signals", row: index + 2, source_class: row.analysis_source_class, included_in_brand_kpi: row.included_in_brand_kpi });
    }
  });
  tables.fact_promotion_offers.forEach((row, index) => {
    const included = booleanValue(row.included_in_official_kpi);
    if ((row.source_class === "brand" && (included !== true || row.review_status !== "approved")) || (row.source_class !== "brand" && included !== false)) {
      sourceIsolationIssues.push({ table: "fact_promotion_offers", row: index + 2, source_class: row.source_class, included_in_official_kpi: row.included_in_official_kpi, review_status: row.review_status });
    }
  });
  tables.mart_hotspot.forEach((row, index) => {
    if (row.source_class !== "editorial") sourceIsolationIssues.push({ table: "mart_hotspot", row: index + 2, source_class: row.source_class });
  });
  addCheck("source_layer.isolation", "source_layer", sourceIsolationIssues.length === 0, "品牌、三方、KOC、编辑热点严格分层", { expected: 0, actual: sourceIsolationIssues.length, details: sourceIsolationIssues.slice(0, 15) });
  const overview = tables.mart_weekly_overview[0];
  const expectedDiscoveryCount = tables.fact_source_signals.length;
  const expectedThirdPartyCount = tables.fact_source_signals.filter((row) => row.analysis_source_class === "third_party").length;
  const expectedKocCount = tables.fact_source_signals.filter((row) => row.analysis_source_class === "koc").length;
  addCheck("source_layer.overview_counts", "source_layer", valuesEqual(overview.discovery_signal_count, expectedDiscoveryCount) && valuesEqual(overview.third_party_post_count, expectedThirdPartyCount) && valuesEqual(overview.koc_post_count, expectedKocCount), "概览只旁列发现层数量，且与事实表一致", { expected: { discovery: expectedDiscoveryCount, third_party: expectedThirdPartyCount, koc: expectedKocCount }, actual: { discovery: overview.discovery_signal_count, third_party: overview.third_party_post_count, koc: overview.koc_post_count } });

  const urlIssues = [];
  for (const [tableName, rows] of Object.entries(tables)) {
    rows.forEach((row, index) => {
      for (const [field, value] of Object.entries(row)) {
        if (field.toLowerCase().includes("url") && EPHEMERAL_URL_PARAMETER.test(String(value || ""))) {
          urlIssues.push({ location: `${tableName}[${index}].${field}`, value });
        }
      }
    });
  }
  collectEphemeralUrls(bi, "bi_dashboard_snapshot", urlIssues);
  collectEphemeralUrls(pageData, "radar_v12_data", urlIssues);
  addCheck("url.canonical_no_ephemeral_params", "canonical_url", urlIssues.length === 0, "所有规范链接均不含xsec或m_source临时参数", { expected: 0, actual: urlIssues.length, details: urlIssues.slice(0, 10) });

  const eventRowsById = new Map(tables.fact_events.map((row) => [row.event_id, row]));
  const bridgeByEvent = new Map();
  for (const row of tables.bridge_event_content) {
    if (!bridgeByEvent.has(row.event_id)) bridgeByEvent.set(row.event_id, []);
    bridgeByEvent.get(row.event_id).push(row.content_id);
  }
  const engagementByContent = new Map(tables.fact_engagement_snapshots.map((row) => [row.content_id, row]));
  const themeMetricFields = ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_missing_count", "likes_sum", "likes_mean", "likes_median", "likes_p75", "likes_p90", "likes_max", "top_content_id", "sample_flag", "snapshot_age_hours_min", "snapshot_age_hours_median", "snapshot_age_hours_max", "top3_event_content_share"];
  for (const metric of tables.mart_theme_metrics) {
    const eventRows = tables.fact_events.filter((row) => splitMulti(row.theme_ids).includes(metric.theme_id));
    const contentIdsForTheme = unique(eventRows.flatMap((row) => bridgeByEvent.get(row.event_id) || []));
    const eventContentCounts = eventRows.map((row) => unique(bridgeByEvent.get(row.event_id) || []).length).sort((left, right) => right - left);
    const recomputed = {
      event_count: eventRows.length,
      active_brand_count: unique(eventRows.map((row) => row.primary_brand_id)).length,
      ...engagementStats(contentIdsForTheme, engagementByContent),
      top3_event_content_share: contentIdsForTheme.length ? round(eventContentCounts.slice(0, 3).reduce((sum, value) => sum + value, 0) / contentIdsForTheme.length) : null,
    };
    const differences = compareRowFields(metric, recomputed, themeMetricFields);
    addCheck(`recompute.theme.${metric.theme_id}`, "metric_recomputation", differences.length === 0, `${metric.theme_label}主题指标由事实表重算一致`, { expected: recomputed, actual: Object.fromEntries(themeMetricFields.map((field) => [field, metric[field]])), details: differences });
  }
  const expectedThemeIds = periodV11.theme_analyses.map((analysis) => analysis.theme_id).sort();
  const actualThemeIds = tables.mart_theme_metrics.map((row) => row.theme_id).sort();
  addCheck("recompute.theme.members", "metric_recomputation", stableJson(actualThemeIds) === stableJson(expectedThemeIds), "主题指标集合与冻结口径一致", { expected: expectedThemeIds, actual: actualThemeIds });

  const tagMetricFields = ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_missing_count", "likes_sum", "likes_mean", "likes_median", "likes_p75", "likes_p90", "likes_max", "top_content_id", "sample_flag", "snapshot_age_hours_min", "snapshot_age_hours_median", "snapshot_age_hours_max", "pending_event_count", "review_status"];
  for (const metric of tables.mart_tag_metrics) {
    const eventRows = tables.fact_events.filter((row) => splitMulti(row.theme_ids).includes(metric.theme_id) && splitMulti(row.tag_ids).includes(metric.tag_id));
    const contentIdsForTag = unique(eventRows.flatMap((row) => bridgeByEvent.get(row.event_id) || []));
    const pendingEventCount = eventRows.filter((row) => row.tag_review_status !== "codex_reviewed").length;
    const recomputed = {
      event_count: eventRows.length,
      active_brand_count: unique(eventRows.map((row) => row.primary_brand_id)).length,
      ...engagementStats(contentIdsForTag, engagementByContent),
      pending_event_count: pendingEventCount,
      review_status: pendingEventCount ? "provisional_due_to_event_review" : "approved",
    };
    const differences = compareRowFields(metric, recomputed, tagMetricFields);
    addCheck(`recompute.tag.${metric.theme_id}.${metric.tag_id}`, "metric_recomputation", differences.length === 0, `${metric.tag_name}标签指标由事实表重算一致`, { expected: recomputed, actual: Object.fromEntries(tagMetricFields.map((field) => [field, metric[field]])), details: differences });
  }
  const expectedThemeTagKeys = [
    ...periodV11.theme_analyses.flatMap((analysis) => analysis.tags.map((tag) => `${analysis.theme_id}|${tag.tag_id}`)),
    ...V12_ADDITIONAL_THEME_TAGS.map((row) => `${row.theme_id}|${row.tag_id}`),
  ].sort();
  const actualThemeTagKeys = tables.mart_tag_metrics.map((row) => `${row.theme_id}|${row.tag_id}`).sort();
  addCheck("recompute.tag.members", "metric_recomputation", stableJson(actualThemeTagKeys) === stableJson(expectedThemeTagKeys), "标签指标集合与冻结口径一致", { expected: expectedThemeTagKeys, actual: actualThemeTagKeys });
  const jasmineMetric = tables.mart_tag_metrics.find((row) => row.theme_id === "product_action" && row.tag_id === "product-jasmine");
  const jasmineExpected = { event_count: 3, content_count: 5, likes_sum: 3429 };
  const jasmineActual = jasmineMetric ? Object.fromEntries(Object.keys(jasmineExpected).map((field) => [field, numeric(jasmineMetric[field])])) : null;
  addCheck("recompute.tag.product_jasmine_correction", "metric_recomputation", Boolean(jasmineActual) && stableJson(jasmineActual) === stableJson(jasmineExpected), "茉莉标签已排除品牌名误识别并按确认口径重算", { expected: jasmineExpected, actual: jasmineActual });

  const eventMetricFields = ["event_count", "active_brand_count", "theme_count", "content_count", "likes_valid_count", "likes_missing_count", "likes_sum", "likes_mean", "likes_median", "likes_p75", "likes_p90", "likes_max", "top_content_id", "sample_flag", "snapshot_age_hours_min", "snapshot_age_hours_median", "snapshot_age_hours_max", "review_status"];
  for (const metric of tables.mart_event_metrics) {
    const event = eventRowsById.get(metric.event_id);
    const eventContentIds = unique(bridgeByEvent.get(metric.event_id) || []);
    const recomputed = {
      event_count: event ? 1 : 0,
      active_brand_count: event?.primary_brand_id ? 1 : 0,
      theme_count: splitMulti(event?.theme_ids).length,
      ...engagementStats(eventContentIds, engagementByContent),
      review_status: event && String(event.tag_review_status).startsWith("codex_reviewed") ? "approved" : "needs_review",
    };
    const differences = compareRowFields(metric, recomputed, eventMetricFields);
    addCheck(`recompute.event.${metric.event_id}`, "metric_recomputation", differences.length === 0, `${metric.event_name}事件指标由事实表重算一致`, { expected: recomputed, actual: Object.fromEntries(eventMetricFields.map((field) => [field, metric[field]])), details: differences });
  }

  const overviewExpected = {
    unique_event_count: tables.fact_events.length,
    brand_content_count: tables.fact_contents.length,
    active_brand_count: unique(tables.fact_contents.map((row) => row.brand_id)).length,
    entity_count: tables.dim_entities.filter((row) => row.status !== "inactive_rejected_v1.2").length,
    observation_count: tables.fact_engagement_snapshots.length,
    theme_membership_count: tables.fact_events.reduce((sum, row) => sum + splitMulti(row.theme_ids).length, 0),
    theme_union_event_count: tables.fact_events.filter((row) => splitMulti(row.theme_ids).length).length,
    discovery_signal_count: tables.fact_source_signals.length,
    approved_event_review_count: tables.fact_events.filter((row) => String(row.tag_review_status).startsWith("codex_reviewed")).length,
    pending_event_review_count: tables.fact_events.filter((row) => !String(row.tag_review_status).startsWith("codex_reviewed")).length,
    review_completion_rate: tables.fact_events.length ? round(tables.fact_events.filter((row) => String(row.tag_review_status).startsWith("codex_reviewed")).length / tables.fact_events.length) : null,
    pending_content_review_count: tables.fact_contents.filter((row) => row.review_status !== "approved").length,
    pending_relation_review_count: tables.bridge_content_entity.filter((row) => String(row.review_status).includes("needs") || String(row.review_status).includes("pending")).length,
    resolved_review_decision_count: tables.review_decisions.length,
    rejected_relation_count: tables.bridge_content_entity.filter((row) => row.review_status === "rejected_v1.2" && booleanValue(row.is_active) === false).length,
    promotion_official_count: tables.fact_promotion_offers.filter((row) => booleanValue(row.included_in_official_kpi) === true).length,
    promotion_discovery_count: tables.fact_promotion_offers.filter((row) => booleanValue(row.included_in_official_kpi) === false).length,
    ...engagementStats(tables.fact_contents.map((row) => row.content_id), engagementByContent),
  };
  const overviewFields = Object.keys(overviewExpected);
  const overviewDifferences = compareRowFields(overview, overviewExpected, overviewFields);
  addCheck("recompute.overview", "metric_recomputation", overviewDifferences.length === 0, "总览指标由事实表重算一致", { expected: overviewExpected, actual: Object.fromEntries(overviewFields.map((field) => [field, overview[field]])), details: overviewDifferences });

  compareTables("bi.csv.overview", "bi_reconciliation", [bi.overview], tables.mart_weekly_overview, ["period_id"], Object.keys(tables.mart_weekly_overview[0] || {}));
  compareTables("bi.csv.event_metrics", "bi_reconciliation", bi.event_metrics || [], tables.mart_event_metrics, ["period_id", "event_id"], Object.keys(tables.mart_event_metrics[0] || {}));
  compareTables("bi.csv.themes", "bi_reconciliation", bi.themes || [], tables.mart_theme_metrics, ["period_id", "theme_id"], Object.keys(tables.mart_theme_metrics[0] || {}));
  compareTables("bi.csv.tags", "bi_reconciliation", bi.tags || [], tables.mart_tag_metrics, ["period_id", "theme_id", "tag_id"], Object.keys(tables.mart_tag_metrics[0] || {}));
  compareTables("bi.csv.brands", "bi_reconciliation", bi.brands || [], tables.mart_brand_metrics, ["period_id", "brand_id"], Object.keys(tables.mart_brand_metrics[0] || {}));
  compareTables("bi.csv.product_categories", "bi_reconciliation", bi.product_categories || [], tables.mart_product_category, ["period_id", "category_level", "category_code"], Object.keys(tables.mart_product_category[0] || {}));
  compareTables("bi.csv.ingredients", "bi_reconciliation", bi.ingredients || [], tables.mart_ingredient, ["period_id", "entity_id"], Object.keys(tables.mart_ingredient[0] || {}));
  compareTables("bi.csv.collaborations", "bi_reconciliation", bi.collaborations || [], tables.mart_collaboration, ["period_id", "entity_id"], Object.keys(tables.mart_collaboration[0] || {}));
  compareTables("bi.csv.promotions", "bi_reconciliation", bi.promotions || [], tables.fact_promotion_offers, ["promotion_id"], Object.keys(tables.fact_promotion_offers[0] || {}));
  compareTables("bi.csv.promotion_metrics", "bi_reconciliation", bi.promotion_metrics || [], tables.mart_promotion, ["period_id", "source_class", "promotion_type"], Object.keys(tables.mart_promotion[0] || {}));
  compareTables("bi.csv.hotspots", "bi_reconciliation", bi.hotspots || [], tables.mart_hotspot, ["report_period_id", "topic_id"], Object.keys(tables.mart_hotspot[0] || {}));
  compareTables("analysis.json.csv", "bi_reconciliation", analysisJson, tables.analysis_insights, ["insight_id"], Object.keys(tables.analysis_insights[0] || {}));
  compareTables("bi.analysis.json", "bi_reconciliation", bi.insights || [], analysisJson, ["insight_id"], Object.keys(tables.analysis_insights[0] || {}));

  const longExpected = [
    ...tables.mart_theme_metrics.flatMap((row) => ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_median", "likes_p75", "likes_mean", "likes_max"].map((metricId) => ({
      period_id: row.period_id, dimension_type: "theme", dimension_id: row.theme_id, dimension_name: row.theme_label, metric_id: metricId, metric_value: row[metricId], source_class: "brand", metric_version: METRIC_VERSION,
    }))),
    ...tables.mart_tag_metrics.flatMap((row) => ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_median", "likes_p75"].map((metricId) => ({
      period_id: row.period_id, dimension_type: "tag", dimension_id: row.tag_id, dimension_name: row.tag_name, metric_id: metricId, metric_value: row[metricId], source_class: "brand", metric_version: METRIC_VERSION,
    }))),
  ];
  compareTables("bi.long_metrics", "bi_reconciliation", tables.bi_metric_long, longExpected, ["period_id", "dimension_type", "dimension_id", "metric_id"], ["dimension_name", "metric_value", "source_class", "metric_version"]);

  addCheck("page.js.parse", "page_data", Boolean(pageData), "页面数据JS可解析并提供RADAR_V12_DATA");
  addCheck("page.meta", "page_data", pageData.meta?.release === RELEASE && pageData.meta?.source_release === "V1.1" && pageData.meta?.rule_version === RULE_VERSION, "页面数据版本元信息正确", { expected: { release: RELEASE, source_release: "V1.1", rule_version: RULE_VERSION }, actual: { release: pageData.meta?.release, source_release: pageData.meta?.source_release, rule_version: pageData.meta?.rule_version } });
  addCheck("page.bi.full_snapshot", "page_data", stableJson(pageData.bi) === stableJson(bi), "页面内嵌BI快照与正式BI JSON完全一致", { expected: "identical", actual: stableJson(pageData.bi) === stableJson(bi) ? "identical" : "different" });
  const criticalPageNumbers = ["unique_event_count", "brand_content_count", "active_brand_count", "entity_count", "likes_valid_count", "likes_median", "likes_p75", "approved_event_review_count", "pending_event_review_count", "resolved_review_decision_count", "rejected_relation_count", "promotion_official_count", "promotion_discovery_count"];
  const criticalPageDifferences = compareRowFields(pageData.bi?.overview, overview, criticalPageNumbers);
  addCheck("page.bi.key_numbers", "page_data", criticalPageDifferences.length === 0, "页面总览关键数字与CSV一致", { expected: Object.fromEntries(criticalPageNumbers.map((field) => [field, overview[field]])), actual: Object.fromEntries(criticalPageNumbers.map((field) => [field, pageData.bi?.overview?.[field]])), details: criticalPageDifferences });
  compareTables("page.bi.event_numbers", "page_data", pageData.bi?.event_metrics || [], tables.mart_event_metrics, ["period_id", "event_id"], ["content_count", "likes_valid_count", "likes_median", "likes_p75", "likes_mean", "likes_max", "review_status"]);
  compareTables("page.bi.theme_numbers", "page_data", pageData.bi?.themes || [], tables.mart_theme_metrics, ["period_id", "theme_id"], ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_median", "likes_p75", "likes_mean", "likes_max"]);
  compareTables("page.bi.tag_numbers", "page_data", pageData.bi?.tags || [], tables.mart_tag_metrics, ["period_id", "theme_id", "tag_id"], ["event_count", "content_count", "active_brand_count", "likes_valid_count", "likes_median", "likes_p75"]);
  compareTables("page.editorial.hotspots", "page_data", pageData.editorial_reference?.topics || [], tables.mart_hotspot, ["report_period_id", "topic_id"], ["display_rank", "likes", "canonical_url", "hot_phrase", "review_status"]);
} catch (error) {
  addCheck("validator.runtime", "runtime", false, "校验器读取或解析失败", { actual: error instanceof Error ? error.message : String(error) });
}

const failed = checks.filter((check) => check.status === "failed");
const categorySummary = Object.fromEntries([...new Set(checks.map((check) => check.category))].sort().map((category) => {
  const categoryChecks = checks.filter((check) => check.category === category);
  return [category, { total: categoryChecks.length, passed: categoryChecks.filter((check) => check.status === "passed").length, failed: categoryChecks.filter((check) => check.status === "failed").length }];
}));
const result = {
  schema_version: "release-validation-v1.2",
  release: RELEASE,
  period_id: PERIOD_ID,
  checked_at: new Date().toISOString(),
  status: failed.length === 0 ? "passed" : "failed",
  summary: {
    total_checks: checks.length,
    passed_checks: checks.length - failed.length,
    failed_checks: failed.length,
    categories: categorySummary,
  },
  failed_check_ids: failed.map((check) => check.id),
  checks,
};

const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
fs.mkdirSync(path.dirname(VALIDATION_REPORT_FILE), { recursive: true });
fs.writeFileSync(VALIDATION_REPORT_FILE, serializedResult);
process.stdout.write(serializedResult);
if (failed.length) process.exitCode = 1;
