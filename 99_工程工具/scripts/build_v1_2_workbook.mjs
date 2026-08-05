import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, "02_数据清洗/处理后数据/V1.2");
const SNAPSHOT_DIR = path.join(RELEASE_DIR, "周期快照/2026-W30");
const RULE_DIR = path.join(ROOT, "02_数据清洗/规则");
const OUTPUT_FILE = path.join(RELEASE_DIR, "饮品热点雷达_V1.2_BI数据中心.xlsx");
const PREVIEW_DIR = path.join(ROOT, "99_工程工具/outputs/V1.2/workbook_preview");

const paths = {
  weekly: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_weekly_overview.csv"),
  themes: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_theme_metrics.csv"),
  tags: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_tag_metrics.csv"),
  categories: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_product_category.csv"),
  ingredients: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_ingredient.csv"),
  collaborations: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_collaboration.csv"),
  promotionMetrics: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_promotion.csv"),
  promotionDetails: path.join(SNAPSHOT_DIR, "01_标准化明细/fact_promotion_offers.csv"),
  brands: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_brand_metrics.csv"),
  hotspots: path.join(SNAPSHOT_DIR, "03_汇总指标/mart_hotspot.csv"),
  reviewQueue: path.join(SNAPSHOT_DIR, "02_AI打标与人工复核/tag_review_queue.csv"),
  insights: path.join(SNAPSHOT_DIR, "04_分析结论/analysis_insights.csv"),
  fieldDictionary: path.join(RULE_DIR, "01_字段字典/字段字典_V1.2.csv"),
  metricDictionary: path.join(RULE_DIR, "02_指标字典/指标字典_V1.2.csv"),
  tagDictionary: path.join(RULE_DIR, "03_标签字典/标签字典_V1.2.csv"),
  manifest: path.join(RELEASE_DIR, "manifest.json"),
};

const colors = {
  ink: "#1D2621",
  leaf: "#315B49",
  leafDark: "#203E34",
  leafPale: "#DCE7DD",
  paper: "#F3EFE5",
  paperSoft: "#FBF8F0",
  line: "#D9D1C4",
  orange: "#D96B3B",
  orangePale: "#F8E4D7",
  yellowPale: "#F6EDC9",
  red: "#A44836",
  redPale: "#F3DDD7",
  green: "#3F765B",
  greenPale: "#DDEBDF",
  muted: "#667067",
  white: "#FFFFFF",
};

const numericFields = new Set([
  "display_order", "display_rank", "category_level", "event_count", "content_count",
  "brand_content_count", "active_brand_count", "entity_count", "observation_count",
  "theme_count", "theme_membership_count", "theme_union_event_count", "discovery_signal_count",
  "third_party_post_count", "koc_post_count", "editorial_topic_count", "approved_event_review_count",
  "pending_event_review_count", "pending_content_review_count", "pending_relation_review_count",
  "promotion_official_count", "promotion_discovery_count", "comparable_period_count", "offer_count",
  "approved_count", "pending_count", "likes", "likes_valid_count", "likes_missing_count",
  "likes_sum", "likes_mean", "likes_median", "likes_p75", "likes_p90", "likes_max",
  "snapshot_age_hours_min", "snapshot_age_hours_median", "snapshot_age_hours_max",
  "review_completion_rate", "top3_event_content_share",
]);

const dateFields = new Set([
  "start_date", "end_date", "published_at", "captured_at", "direct_url_verified_at",
  "reviewed_at", "effective_from",
]);

function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
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
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell !== ""));
}

function coerce(field, value) {
  if (value === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (dateFields.has(field)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (numericFields.has(field)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return value;
}

async function readCsv(file) {
  const rows = parseCsv(await fs.readFile(file, "utf8"));
  const headers = rows.shift() ?? [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, coerce(header, cells[index] ?? "")])));
}

function colLetter(index) {
  let number = index + 1;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function compareNumberDesc(field) {
  return (a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0);
}

const [
  weekly,
  themes,
  tags,
  categories,
  ingredients,
  collaborations,
  promotionMetrics,
  promotionDetails,
  brands,
  hotspots,
  reviewQueue,
  insights,
  fieldDictionary,
  metricDictionary,
  tagDictionary,
  manifest,
] = await Promise.all([
  readCsv(paths.weekly),
  readCsv(paths.themes),
  readCsv(paths.tags),
  readCsv(paths.categories),
  readCsv(paths.ingredients),
  readCsv(paths.collaborations),
  readCsv(paths.promotionMetrics),
  readCsv(paths.promotionDetails),
  readCsv(paths.brands),
  readCsv(paths.hotspots),
  readCsv(paths.reviewQueue),
  readCsv(paths.insights),
  readCsv(paths.fieldDictionary),
  readCsv(paths.metricDictionary),
  readCsv(paths.tagDictionary),
  JSON.parse(await fs.readFile(paths.manifest, "utf8")),
]);

const orderedThemes = [...themes].sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99));
const orderedTags = [...tags].sort((a, b) => {
  const eventDiff = (b.event_count ?? 0) - (a.event_count ?? 0);
  return eventDiff || (b.likes_median ?? 0) - (a.likes_median ?? 0);
});
const orderedCategories = [...categories].sort((a, b) => {
  const levelDiff = (a.category_level ?? 99) - (b.category_level ?? 99);
  return levelDiff || (b.event_count ?? 0) - (a.event_count ?? 0);
});
const orderedIngredients = [...ingredients].sort(compareNumberDesc("event_count"));
const orderedCollaborations = [...collaborations].sort(compareNumberDesc("event_count"));
const orderedBrands = [...brands].sort(compareNumberDesc("event_count"));
const orderedHotspots = [...hotspots].sort((a, b) => (a.display_rank ?? 99) - (b.display_rank ?? 99));
const orderedReviews = [...reviewQueue].sort((a, b) => {
  const rank = { high: 1, medium: 2, low: 3 };
  return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
});

if (weekly.length !== 1 || orderedThemes.length < 3) {
  throw new Error(`V1.2 source data is incomplete: weekly=${weekly.length}, themes=${orderedThemes.length}`);
}

const workbook = Workbook.create();
const sheetNames = [
  "使用说明",
  "BI总览",
  "周度总表",
  "主题指标",
  "标签指标",
  "品类",
  "原料",
  "联名",
  "促销",
  "品牌",
  "热点选题",
  "质量与复核",
  "明细导航",
  "字段字典",
  "指标字典",
  "标签字典",
];

for (const name of sheetNames) workbook.worksheets.add(name);

const inspectionRanges = new Map();

function titleSheet(sheet, title, note, columnCount) {
  const end = colLetter(Math.max(0, columnCount - 1));
  sheet.showGridLines = false;
  sheet.getRange(`A1:${end}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A2:${end}2`).merge();
  sheet.getRange("A2").values = [[note]];
  sheet.getRange(`A1:${end}1`).format = {
    fill: colors.leafDark,
    font: { bold: true, color: colors.white, size: 20, name: "Songti SC" },
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${end}2`).format = {
    fill: colors.paper,
    font: { color: colors.muted, size: 10, name: "PingFang SC" },
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("1:1").format.rowHeight = 36;
  sheet.getRange("2:2").format.rowHeight = 34;
}

function styleSectionHeader(range, fill = colors.leaf) {
  range.format = {
    fill,
    font: { bold: true, color: colors.white, size: 10, name: "PingFang SC" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { bottom: { style: "medium", color: colors.leafDark } },
  };
}

function styleBody(range, { wrap = false } = {}) {
  range.format = {
    font: { color: colors.ink, size: 9, name: "PingFang SC" },
    verticalAlignment: "top",
    wrapText: wrap,
    borders: { insideHorizontal: { style: "thin", color: colors.line } },
  };
}

function applyConditionalStatus(sheet, columnIndex, startRow, endRow) {
  if (endRow < startRow) return;
  const column = colLetter(columnIndex);
  const range = sheet.getRange(`${column}${startRow}:${column}${endRow}`);
  range.conditionalFormats.add("containsText", {
    text: "approved",
    format: { fill: colors.greenPale, font: { color: colors.green, bold: true } },
  });
  range.conditionalFormats.add("containsText", {
    text: "needs",
    format: { fill: colors.redPale, font: { color: colors.red, bold: true } },
  });
  range.conditionalFormats.add("containsText", {
    text: "provisional",
    format: { fill: colors.yellowPale, font: { color: colors.ink, bold: true } },
  });
}

function writeDataSheet({
  name,
  title,
  note,
  records,
  columns,
  tableName,
  freezeColumns = 2,
  rowHeight = 24,
  statusKeys = [],
}) {
  const sheet = workbook.worksheets.getItem(name);
  titleSheet(sheet, title, note, columns.length);
  const lastCol = colLetter(columns.length - 1);
  const headerRow = 4;
  const firstDataRow = 5;
  const lastRow = Math.max(headerRow, firstDataRow + records.length - 1);
  sheet.getRange(`A${headerRow}:${lastCol}${headerRow}`).values = [columns.map((column) => column.label)];
  styleSectionHeader(sheet.getRange(`A${headerRow}:${lastCol}${headerRow}`));
  sheet.getRange(`${headerRow}:${headerRow}`).format.rowHeight = 30;

  if (records.length) {
    const matrix = records.map((record) => columns.map((column) => record[column.key] ?? null));
    sheet.getRangeByIndexes(firstDataRow - 1, 0, records.length, columns.length).values = matrix;
    const body = sheet.getRange(`A${firstDataRow}:${lastCol}${lastRow}`);
    styleBody(body);
    const table = sheet.tables.add(`A${headerRow}:${lastCol}${lastRow}`, true, tableName);
    table.style = "TableStyleLight1";
    table.showFilterButton = true;
    table.showBandedRows = true;
    styleSectionHeader(sheet.getRange(`A${headerRow}:${lastCol}${headerRow}`));
    sheet.getRange(`${firstDataRow}:${lastRow}`).format.rowHeight = rowHeight;
  }

  columns.forEach((column, index) => {
    const letter = colLetter(index);
    sheet.getRange(`${letter}:${letter}`).format.columnWidth = column.width ?? 14;
    if (!records.length) return;
    const dataRange = sheet.getRange(`${letter}${firstDataRow}:${letter}${lastRow}`);
    if (column.numberFormat) {
      dataRange.format.numberFormat = column.numberFormat;
      dataRange.format.horizontalAlignment = "right";
    }
    if (column.wrap) dataRange.format.wrapText = true;
    if (column.center) dataRange.format.horizontalAlignment = "center";
  });

  for (const key of statusKeys) {
    const index = columns.findIndex((column) => column.key === key);
    if (index >= 0) applyConditionalStatus(sheet, index, firstDataRow, lastRow);
  }
  sheet.freezePanes.freezeRows(headerRow);
  if (freezeColumns > 0) sheet.freezePanes.freezeColumns(freezeColumns);
  inspectionRanges.set(name, `A1:${lastCol}${lastRow}`);
  return sheet;
}

function mergeWrite(sheet, range, value, format = null) {
  sheet.getRange(range).merge();
  const start = range.split(":")[0];
  sheet.getRange(start).values = [[value]];
  if (format) sheet.getRange(range).format = format;
}

function addCard(sheet, labelRange, valueRange, noteRange, label, formula, note, numberFormat) {
  mergeWrite(sheet, labelRange, label, {
    fill: colors.leafPale,
    font: { bold: true, color: colors.leafDark, size: 10, name: "PingFang SC" },
    verticalAlignment: "center",
    horizontalAlignment: "left",
    borders: { preset: "outside", style: "thin", color: colors.line },
  });
  sheet.getRange(valueRange).merge();
  const valueCell = valueRange.split(":")[0];
  sheet.getRange(valueCell).formulas = [[formula]];
  sheet.getRange(valueRange).format = {
    fill: colors.paperSoft,
    font: { bold: true, color: colors.ink, size: 24, name: "Songti SC" },
    verticalAlignment: "center",
    horizontalAlignment: "left",
    borders: { preset: "outside", style: "thin", color: colors.line },
  };
  sheet.getRange(valueCell).format.numberFormat = numberFormat;
  mergeWrite(sheet, noteRange, note, {
    fill: colors.paperSoft,
    font: { color: colors.muted, size: 9, name: "PingFang SC" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: colors.line },
  });
}

// 使用说明
{
  const sheet = workbook.worksheets.getItem("使用说明");
  titleSheet(
    sheet,
    "饮品热点雷达 V1.2｜BI 数据中心",
    `统计周期：${weekly[0].start_date.toISOString().slice(0, 10)} 至 ${weekly[0].end_date.toISOString().slice(0, 10)}｜生成时间：${manifest.generated_at}｜指标版本：${manifest.metric_version}`,
    10,
  );
  mergeWrite(sheet, "A4:J4", "这份工作簿解决什么", {
    fill: colors.leaf,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  mergeWrite(
    sheet,
    "A5:J6",
    "将已登记的小红书品牌官号内容，按“去重事件—主题—细标签—品类/原料/联名/促销”分层组织，供业务方看结构、看差异、看证据与复核进度。中位数和 P75 是主要互动口径，均值只作辅助；点赞快照不代表销量、转化或行业规模。",
    {
      fill: colors.paperSoft,
      font: { color: colors.ink, size: 11, name: "PingFang SC" },
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "outside", style: "thin", color: colors.line },
    },
  );
  sheet.getRange("5:6").format.rowHeight = 30;

  sheet.getRange("A8:E8").values = [["数据层", "用途", "是否进入品牌 KPI", "主要产出", "管理要求"]];
  styleSectionHeader(sheet.getRange("A8:E8"));
  const layerRows = [
    ["品牌官号", "事实、事件、产品与促销证据", "是", "BI 主指标", "仅使用可回读原帖与已复核关系"],
    ["行业资讯/三方", "发现促销、品牌动态线索", "否", "补充观察", "不与官方 KPI 混算"],
    ["KOC", "用户体验与讨论信号", "否", "观察补充", "不转写为品牌事实"],
    ["编辑热点账号", "近 7 日热棗与选题参考", "否", "热点选题", "不冒充全平台热度排名"],
  ];
  sheet.getRange("A9:E12").values = layerRows;
  styleBody(sheet.getRange("A9:E12"), { wrap: true });
  sheet.getRange("A9:E12").format.rowHeight = 34;
  sheet.getRange("A:A").format.columnWidth = 19;
  sheet.getRange("B:B").format.columnWidth = 34;
  sheet.getRange("C:C").format.columnWidth = 20;
  sheet.getRange("D:D").format.columnWidth = 22;
  sheet.getRange("E:E").format.columnWidth = 38;

  mergeWrite(sheet, "A15:J15", "阅读顺序与口径", {
    fill: colors.orange,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  sheet.getRange("A16:C20").values = [
    ["顺序", "看什么", "如何解读"],
    ["1", "BI总览", "先看总量、审核完成率、三个主题及关键结论"],
    ["2", "主题与标签", "事件数看业务动作广度；内容数看发布密度；标签可重叠"],
    ["3", "品类/原料/联名/促销/品牌", "用于拆解结构；N<5 的小样本不做强弱排名"],
    ["4", "质量与复核", "先消化高优先级异常，再更新标签与结论"],
  ];
  styleSectionHeader(sheet.getRange("A16:C16"), colors.orange);
  styleBody(sheet.getRange("A17:C20"), { wrap: true });
  sheet.getRange("A17:C20").format.rowHeight = 34;
  sheet.getRange("F16").values = [["口径"]];
  mergeWrite(sheet, "G16:J16", "主规则");
  const metricReadingRules = [
    ["主互动指标", "点赞中位数 + P75；同时展示有效N"],
    ["辅助指标", "均值和最大值只用于识别长尾与极值"],
    ["趋势", "至少 2 个可比周才开启环比，至少 4 周才写趋势"],
    ["边界", "本期仅代表已登记账号和当期窗口"],
  ];
  metricReadingRules.forEach(([label, rule], index) => {
    const row = 17 + index;
    sheet.getRange(`F${row}`).values = [[label]];
    mergeWrite(sheet, `G${row}:J${row}`, rule);
  });
  styleSectionHeader(sheet.getRange("F16:J16"), colors.orange);
  styleBody(sheet.getRange("F17:J20"), { wrap: true });
  sheet.getRange("F17:J20").format.rowHeight = 34;
  sheet.getRange("F:F").format.columnWidth = 18;
  sheet.getRange("G:J").format.columnWidth = 13;
  sheet.freezePanes.freezeRows(2);
  inspectionRanges.set("使用说明", "A1:J20");
}

// 周度总表（为总览与质量页提供可审计引用）
writeDataSheet({
  name: "周度总表",
  title: "周度总表｜官方事实口径",
  note: "BI总览与质量页的卡片使用公式引用本表；三方、KOC 与编辑热点不进入品牌 KPI。",
  records: weekly,
  tableName: "WeeklyOverviewV12",
  freezeColumns: 3,
  columns: [
    { key: "period_id", label: "周期", width: 13 },
    { key: "start_date", label: "开始日期", width: 13, numberFormat: "yyyy-mm-dd" },
    { key: "end_date", label: "结束日期", width: 13, numberFormat: "yyyy-mm-dd" },
    { key: "unique_event_count", label: "去重事件数", width: 13, numberFormat: "#,##0" },
    { key: "brand_content_count", label: "品牌内容数", width: 13, numberFormat: "#,##0" },
    { key: "active_brand_count", label: "活跃品牌数", width: 13, numberFormat: "#,##0" },
    { key: "discovery_signal_count", label: "发现信号数", width: 13, numberFormat: "#,##0" },
    { key: "koc_post_count", label: "KOC内容数", width: 13, numberFormat: "#,##0" },
    { key: "third_party_post_count", label: "三方内容数", width: 13, numberFormat: "#,##0" },
    { key: "editorial_topic_count", label: "编辑热点数", width: 13, numberFormat: "#,##0" },
    { key: "review_completion_rate", label: "事件复核完成率", width: 16, numberFormat: "0.0%" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_missing_count", label: "点赞缺失数", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 17, numberFormat: "#,##0.0" },
    { key: "snapshot_age_hours_median", label: "快照时延中位数(小时)", width: 20, numberFormat: "#,##0.0" },
    { key: "snapshot_age_hours_max", label: "快照最大时延(小时)", width: 18, numberFormat: "#,##0.0" },
    { key: "pending_event_review_count", label: "待复核事件", width: 13, numberFormat: "#,##0" },
    { key: "pending_content_review_count", label: "待复核内容", width: 13, numberFormat: "#,##0" },
    { key: "pending_relation_review_count", label: "待复核关系", width: 13, numberFormat: "#,##0" },
    { key: "promotion_official_count", label: "官方促销证据", width: 14, numberFormat: "#,##0" },
    { key: "promotion_discovery_count", label: "发现层促销线索", width: 16, numberFormat: "#,##0" },
    { key: "comparable_period_count", label: "可比周期数", width: 13, numberFormat: "#,##0" },
    { key: "wow_status", label: "环比状态", width: 24 },
    { key: "trend_status", label: "趋势状态", width: 24 },
    { key: "interpretation_limit", label: "解读边界", width: 55, wrap: true },
  ],
  rowHeight: 56,
});

// BI总览
{
  const sheet = workbook.worksheets.getItem("BI总览");
  titleSheet(
    sheet,
    "饮品热点雷达 V1.2｜BI 总览",
    "结论先行：先看去重事件、内容与品牌覆盖，再用中位数、P75 与有效N判断分布；均值仅作辅助。",
    16,
  );
  addCard(sheet, "A4:D4", "A5:D6", "A7:D7", "去重事件", "='周度总表'!D5", "主题允许重叠，事件总数不重复计算", "#,##0");
  addCard(sheet, "E4:H4", "E5:H6", "E7:H7", "品牌内容", "='周度总表'!E5", "仅已登记品牌官号内容", "#,##0");
  addCard(sheet, "I4:L4", "I5:L6", "I7:L7", "活跃品牌", "='周度总表'!F5", "本周存在有效内容的品牌", "#,##0");
  addCard(sheet, "M4:P4", "M5:P6", "M7:P7", "事件复核完成率", "='周度总表'!K5", orderedReviews.length ? "细标签仍有待复核队列" : "本期已完成事件复核，决议单独留痕", "0.0%");
  sheet.getRange("4:4").format.rowHeight = 25;
  sheet.getRange("5:6").format.rowHeight = 28;
  sheet.getRange("7:7").format.rowHeight = 28;

  mergeWrite(sheet, "A9:G9", "三大核心主题", {
    fill: colors.leaf,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  sheet.getRange("A10:G10").values = [["主题", "事件数", "内容数", "活跃品牌", "点赞中位数", "点赞P75", "均值（辅助）"]];
  styleSectionHeader(sheet.getRange("A10:G10"));
  for (let index = 0; index < 3; index += 1) {
    const sourceRow = 5 + index;
    const targetRow = 11 + index;
    sheet.getRange(`A${targetRow}:G${targetRow}`).formulas = [[
      `='主题指标'!A${sourceRow}`,
      `='主题指标'!B${sourceRow}`,
      `='主题指标'!C${sourceRow}`,
      `='主题指标'!D${sourceRow}`,
      `='主题指标'!F${sourceRow}`,
      `='主题指标'!G${sourceRow}`,
      `='主题指标'!H${sourceRow}`,
    ]];
  }
  styleBody(sheet.getRange("A11:G13"));
  sheet.getRange("B11:G13").format.numberFormat = "#,##0.0";
  sheet.getRange("B11:D13").format.numberFormat = "#,##0";
  sheet.getRange("A10:G13").format.borders = { preset: "outside", style: "thin", color: colors.line };

  sheet.getRange("I9:K9").values = [["主题", "中位数", "P75"]];
  styleSectionHeader(sheet.getRange("I9:K9"), colors.orange);
  for (let index = 0; index < 3; index += 1) {
    const sourceRow = 11 + index;
    const targetRow = 10 + index;
    sheet.getRange(`I${targetRow}:K${targetRow}`).formulas = [[
      `=A${sourceRow}`,
      `=E${sourceRow}`,
      `=F${sourceRow}`,
    ]];
  }
  styleBody(sheet.getRange("I10:K12"));
  sheet.getRange("J10:K12").format.numberFormat = "#,##0";
  const chart = sheet.charts.add("bar", sheet.getRange("I9:K12"));
  chart.title = "主题互动分布：中位数 vs P75（点赞）";
  chart.hasLegend = true;
  chart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 9 } };
  chart.yAxis = { numberFormatCode: "#,##0" };
  chart.setPosition("I14", "P24");

  mergeWrite(sheet, "A16:G16", "高覆盖标签（按事件数排序）", {
    fill: colors.orange,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  sheet.getRange("A17:G17").values = [["标签", "维度", "主题", "事件数", "内容数", "点赞中位数", "审核状态"]];
  styleSectionHeader(sheet.getRange("A17:G17"), colors.orange);
  for (let index = 0; index < 5; index += 1) {
    const sourceRow = 5 + index;
    const targetRow = 18 + index;
    sheet.getRange(`A${targetRow}:G${targetRow}`).formulas = [[
      `='标签指标'!A${sourceRow}`,
      `='标签指标'!B${sourceRow}`,
      `='标签指标'!C${sourceRow}`,
      `='标签指标'!D${sourceRow}`,
      `='标签指标'!E${sourceRow}`,
      `='标签指标'!H${sourceRow}`,
      `='标签指标'!N${sourceRow}`,
    ]];
  }
  styleBody(sheet.getRange("A18:G22"));
  sheet.getRange("D18:F22").format.numberFormat = "#,##0.0";
  sheet.getRange("D18:E22").format.numberFormat = "#,##0";
  applyConditionalStatus(sheet, 6, 18, 22);

  mergeWrite(sheet, "A25:P25", "本期关键判断", {
    fill: colors.leafDark,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  sheet.getRange("A26:C26").merge();
  sheet.getRange("D26:J26").merge();
  sheet.getRange("K26:P26").merge();
  sheet.getRange("A26").values = [["结论"]];
  sheet.getRange("D26").values = [["证据"]];
  sheet.getRange("K26").values = [["边界"]];
  styleSectionHeader(sheet.getRange("A26:P26"));
  const featuredInsights = insights.filter((item) => item.insight_type === "theme").slice(0, 3);
  featuredInsights.forEach((item, index) => {
    const row = 27 + index;
    sheet.getRange(`A${row}:C${row}`).merge();
    sheet.getRange(`D${row}:J${row}`).merge();
    sheet.getRange(`K${row}:P${row}`).merge();
    sheet.getRange(`A${row}`).values = [[item.title]];
    sheet.getRange(`D${row}`).values = [[`${item.conclusion}\n${item.evidence_points}`]];
    sheet.getRange(`K${row}`).values = [[item.boundary_note]];
    styleBody(sheet.getRange(`A${row}:P${row}`), { wrap: true });
    sheet.getRange(`${row}:${row}`).format.rowHeight = 58;
  });

  mergeWrite(sheet, "A32:P32", "解读提醒：主题可重叠，不得把三个主题的事件数相加当作总事件；当前只有 1 个可比周期，环比与趋势判断暂不开启。", {
    fill: colors.yellowPale,
    font: { color: colors.ink, size: 10, bold: true },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: colors.line },
  });
  sheet.getRange("32:32").format.rowHeight = 36;
  for (let i = 0; i < 16; i += 1) sheet.getRange(`${colLetter(i)}:${colLetter(i)}`).format.columnWidth = 11;
  sheet.getRange("A:A").format.columnWidth = 19;
  sheet.getRange("D:D").format.columnWidth = 13;
  sheet.getRange("I:I").format.columnWidth = 17;
  sheet.freezePanes.freezeRows(2);
  inspectionRanges.set("BI总览", "A1:P32");
}

// 主题与标签指标
writeDataSheet({
  name: "主题指标",
  title: "主题指标｜事件、内容与互动分布",
  note: "事件数是业务动作主口径；主题允许重叠。中位数与 P75 是主指标，均值仅作长尾参考。",
  records: orderedThemes,
  tableName: "ThemeMetricsV12",
  columns: [
    { key: "theme_label", label: "主题", width: 18 },
    { key: "event_count", label: "事件数", width: 11, numberFormat: "#,##0" },
    { key: "content_count", label: "内容数", width: 11, numberFormat: "#,##0" },
    { key: "active_brand_count", label: "活跃品牌", width: 12, numberFormat: "#,##0" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 18, numberFormat: "#,##0.0" },
    { key: "likes_p90", label: "点赞P90", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_max", label: "最大值", width: 12, numberFormat: "#,##0" },
    { key: "representative_event_name", label: "代表事件", width: 34, wrap: true },
    { key: "top3_event_content_share", label: "前三事件内容占比", width: 18, numberFormat: "0.0%" },
    { key: "sample_flag", label: "样本标识", width: 26 },
    { key: "review_status", label: "审核状态", width: 17 },
    { key: "metric_scope", label: "指标边界", width: 34, wrap: true },
  ],
  rowHeight: 34,
  statusKeys: ["review_status"],
});

writeDataSheet({
  name: "标签指标",
  title: "标签指标｜细颗度业务标签",
  note: "标签按事件数降序；标签可重叠。标注 provisional 的行仍包含待复核事件，不用于强结论。",
  records: orderedTags,
  tableName: "TagMetricsV12",
  columns: [
    { key: "tag_name", label: "标签", width: 24 },
    { key: "tag_dimension", label: "标签维度", width: 18 },
    { key: "theme_label", label: "所属主题", width: 15 },
    { key: "event_count", label: "事件数", width: 11, numberFormat: "#,##0" },
    { key: "content_count", label: "内容数", width: 11, numberFormat: "#,##0" },
    { key: "active_brand_count", label: "活跃品牌", width: 12, numberFormat: "#,##0" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 18, numberFormat: "#,##0.0" },
    { key: "likes_max", label: "最大值", width: 12, numberFormat: "#,##0" },
    { key: "pending_event_count", label: "待复核事件", width: 13, numberFormat: "#,##0" },
    { key: "sample_flag", label: "样本标识", width: 26 },
    { key: "review_status", label: "审核状态", width: 28 },
    { key: "metric_scope", label: "指标边界", width: 34, wrap: true },
  ],
  rowHeight: 32,
  statusKeys: ["review_status"],
});

writeDataSheet({
  name: "品类",
  title: "品类分析｜一级与二级分类",
  note: "先看一级结构，再下钻二级品类。N<5 标记为小样本，不进入强弱排名。",
  records: orderedCategories,
  tableName: "ProductCategoryV12",
  columns: [
    { key: "category_level", label: "层级", width: 9, numberFormat: "#,##0" },
    { key: "category_name", label: "品类", width: 22 },
    { key: "parent_category_name", label: "上级品类", width: 20 },
    { key: "event_count", label: "事件数", width: 11, numberFormat: "#,##0" },
    { key: "content_count", label: "内容数", width: 11, numberFormat: "#,##0" },
    { key: "active_brand_count", label: "活跃品牌", width: 12, numberFormat: "#,##0" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 18, numberFormat: "#,##0.0" },
    { key: "likes_max", label: "最大值", width: 12, numberFormat: "#,##0" },
    { key: "sample_flag", label: "样本标识", width: 26 },
    { key: "top_content_id", label: "代表内容ID", width: 30 },
  ],
});

writeDataSheet({
  name: "原料",
  title: "原料/产品元素｜跨品牌信号",
  note: "signal_level=trend_candidate 仅表示已满足当期跨品牌候选条件，不代表行业趋势已经得证。",
  records: orderedIngredients,
  tableName: "IngredientMetricsV12",
  columns: [
    { key: "entity_name", label: "原料/元素", width: 22 },
    { key: "parent_category", label: "归属", width: 18 },
    { key: "signal_level", label: "信号级别", width: 18 },
    { key: "event_count", label: "事件数", width: 11, numberFormat: "#,##0" },
    { key: "content_count", label: "内容数", width: 11, numberFormat: "#,##0" },
    { key: "active_brand_count", label: "活跃品牌", width: 12, numberFormat: "#,##0" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 18, numberFormat: "#,##0.0" },
    { key: "likes_max", label: "最大值", width: 12, numberFormat: "#,##0" },
    { key: "sample_flag", label: "样本标识", width: 26 },
  ],
});

writeDataSheet({
  name: "联名",
  title: "联名分析｜合作方与 IP 类型",
  note: "联名主体多为单品牌案例；小样本行仅用于案例发现，不用于推断赛道热度。",
  records: orderedCollaborations,
  tableName: "CollaborationMetricsV12",
  columns: [
    { key: "entity_name", label: "联名方/IP", width: 26 },
    { key: "parent_category", label: "类型", width: 22 },
    { key: "signal_level", label: "信号级别", width: 18 },
    { key: "event_count", label: "事件数", width: 11, numberFormat: "#,##0" },
    { key: "content_count", label: "内容数", width: 11, numberFormat: "#,##0" },
    { key: "active_brand_count", label: "活跃品牌", width: 12, numberFormat: "#,##0" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 18, numberFormat: "#,##0.0" },
    { key: "likes_max", label: "最大值", width: 12, numberFormat: "#,##0" },
    { key: "sample_flag", label: "样本标识", width: 26 },
  ],
});

// 促销：汇总 + 逐条证据
{
  const sheet = workbook.worksheets.getItem("促销");
  titleSheet(sheet, "促销观测｜机制汇总与逐条证据", "品牌官方证据与发现层线索分开统计；只有 included_in_official_kpi=true 的证据进入官方口径。", 11);
  mergeWrite(sheet, "A4:G4", "促销机制汇总", {
    fill: colors.leaf,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  const summaryColumns = [
    ["source_class", "来源层"], ["promotion_type", "促销类型"], ["offer_count", "证据数"],
    ["active_brand_count", "活跃品牌"], ["approved_count", "已审核"], ["pending_count", "待复核"],
    ["included_in_official_kpi", "进入官方KPI"],
  ];
  sheet.getRange("A5:G5").values = [summaryColumns.map((item) => item[1])];
  styleSectionHeader(sheet.getRange("A5:G5"));
  const summaryEnd = 5 + promotionMetrics.length;
  sheet.getRangeByIndexes(5, 0, promotionMetrics.length, summaryColumns.length).values = promotionMetrics.map((record) => summaryColumns.map(([key]) => record[key] ?? null));
  styleBody(sheet.getRange(`A6:G${summaryEnd}`));
  sheet.getRange(`C6:F${summaryEnd}`).format.numberFormat = "#,##0";
  const summaryTable = sheet.tables.add(`A5:G${summaryEnd}`, true, "PromotionSummaryV12");
  summaryTable.style = "TableStyleLight1";
  summaryTable.showFilterButton = true;
  styleSectionHeader(sheet.getRange("A5:G5"));

  const detailHeaderRow = summaryEnd + 4;
  mergeWrite(sheet, `A${detailHeaderRow - 1}:K${detailHeaderRow - 1}`, "逐条促销证据", {
    fill: colors.orange,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  const detailColumns = [
    ["source_class", "来源层"], ["primary_brand_name", "品牌"], ["promotion_type", "类型"], ["mechanism", "机制"],
    ["start_date", "开始日期"], ["end_date", "结束日期"], ["evidence_note", "证据说明"],
    ["canonical_url", "原帖链接"], ["review_status", "审核状态"], ["included_in_official_kpi", "进入官方KPI"], ["captured_at", "抓取时间"],
  ];
  sheet.getRange(`A${detailHeaderRow}:K${detailHeaderRow}`).values = [detailColumns.map((item) => item[1])];
  styleSectionHeader(sheet.getRange(`A${detailHeaderRow}:K${detailHeaderRow}`), colors.orange);
  const detailFirst = detailHeaderRow + 1;
  const detailLast = detailHeaderRow + promotionDetails.length;
  sheet.getRangeByIndexes(detailFirst - 1, 0, promotionDetails.length, detailColumns.length).values = promotionDetails.map((record) => detailColumns.map(([key]) => record[key] ?? null));
  styleBody(sheet.getRange(`A${detailFirst}:K${detailLast}`), { wrap: true });
  sheet.getRange(`${detailFirst}:${detailLast}`).format.rowHeight = 46;
  sheet.getRange(`E${detailFirst}:F${detailLast}`).format.numberFormat = "yyyy-mm-dd";
  sheet.getRange(`K${detailFirst}:K${detailLast}`).format.numberFormat = "yyyy-mm-dd hh:mm";
  const detailTable = sheet.tables.add(`A${detailHeaderRow}:K${detailLast}`, true, "PromotionEvidenceV12");
  detailTable.style = "TableStyleLight1";
  detailTable.showFilterButton = true;
  styleSectionHeader(sheet.getRange(`A${detailHeaderRow}:K${detailHeaderRow}`), colors.orange);
  applyConditionalStatus(sheet, 8, detailFirst, detailLast);
  const promoWidths = [14, 16, 16, 38, 13, 13, 34, 45, 16, 17, 20];
  promoWidths.forEach((width, index) => { sheet.getRange(`${colLetter(index)}:${colLetter(index)}`).format.columnWidth = width; });
  sheet.freezePanes.freezeRows(detailHeaderRow);
  sheet.freezePanes.freezeColumns(2);
  inspectionRanges.set("促销", `A1:K${detailLast}`);
}

writeDataSheet({
  name: "品牌",
  title: "品牌对比｜事件广度、内容密度与互动分布",
  note: "各品牌发布数、账号规模和内容风格不同，不应仅根据均值排名；优先看事件数、中位数、P75 与有效N。",
  records: orderedBrands,
  tableName: "BrandMetricsV12",
  columns: [
    { key: "brand_name", label: "品牌", width: 20 },
    { key: "event_count", label: "事件数", width: 11, numberFormat: "#,##0" },
    { key: "content_count", label: "内容数", width: 11, numberFormat: "#,##0" },
    { key: "theme_count", label: "覆盖主题数", width: 13, numberFormat: "#,##0" },
    { key: "pending_event_count", label: "待复核事件", width: 13, numberFormat: "#,##0" },
    { key: "likes_valid_count", label: "点赞有效N", width: 13, numberFormat: "#,##0" },
    { key: "likes_median", label: "点赞中位数", width: 13, numberFormat: "#,##0.0" },
    { key: "likes_p75", label: "点赞P75", width: 12, numberFormat: "#,##0.0" },
    { key: "likes_mean", label: "点赞均值（辅助）", width: 18, numberFormat: "#,##0.0" },
    { key: "likes_max", label: "最大值", width: 12, numberFormat: "#,##0" },
    { key: "snapshot_age_hours_median", label: "快照时延中位数(小时)", width: 20, numberFormat: "#,##0.0" },
    { key: "snapshot_age_hours_max", label: "快照最大时延(小时)", width: 18, numberFormat: "#,##0.0" },
    { key: "sample_flag", label: "样本标识", width: 26 },
    { key: "top_content_id", label: "代表内容ID", width: 30 },
  ],
});

writeDataSheet({
  name: "热点选题",
  title: "近 7 日热点选题｜编辑参考层",
  note: "热点账号的收录和互动快照只用于选题，不进入品牌 KPI，也不代表全平台热度排名。",
  records: orderedHotspots,
  tableName: "HotspotTopicsV12",
  columns: [
    { key: "display_rank", label: "序号", width: 8, numberFormat: "#,##0" },
    { key: "hot_phrase", label: "热棗/热句", width: 25, wrap: true },
    { key: "plain_explanation", label: "通俗解释", width: 44, wrap: true },
    { key: "why_now", label: "为什么是现在", width: 44, wrap: true },
    { key: "brand_application", label: "品牌应用思路", width: 46, wrap: true },
    { key: "likes", label: "点赞快照", width: 12, numberFormat: "#,##0" },
    { key: "canonical_url", label: "原帖链接", width: 46 },
    { key: "review_status", label: "审核状态", width: 16 },
    { key: "boundary_note", label: "解读边界", width: 48, wrap: true },
  ],
  rowHeight: 68,
  statusKeys: ["review_status"],
});

// 质量与复核
{
  const sheet = workbook.worksheets.getItem("质量与复核");
  titleSheet(sheet, "数据质量与人工复核", "所有未完成的事件、内容与关系复核保留在队列中；未复核的细标签不应直接用于强结论。", 11);
  addCard(sheet, "A4:C4", "A5:C6", "A7:C7", "事件复核完成率", "='周度总表'!K5", "已审核事件/全部事件", "0.0%");
  addCard(sheet, "D4:F4", "D5:F6", "D7:F7", "点赞完整率", "=IF(('周度总表'!L5+'周度总表'!M5)=0,\"\",'周度总表'!L5/('周度总表'!L5+'周度总表'!M5))", "点赞有效N/全部品牌内容", "0.0%");
  addCard(sheet, "G4:I4", "G5:I6", "G7:I7", "待复核事件", "='周度总表'!S5", "优先处理 high 优先级队列", "#,##0");
  addCard(sheet, "J4:K4", "J5:K6", "J7:K7", "快照最大时延", "='周度总表'!R5", "单位：小时；互动快照不等时", "#,##0.0");

  mergeWrite(sheet, "A10:E10", "质量门槛", {
    fill: colors.leaf,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  sheet.getRange("A11:E11").values = [["核查项", "当前值", "目标/规则", "状态", "说明"]];
  styleSectionHeader(sheet.getRange("A11:E11"));
  const qualityRows = [
    ["点赞缺失数", "='周度总表'!M5", "=0", "=IF(B12=0,\"通过\",\"需处理\")", "缺失值保持为空，不补 0"],
    ["事件复核完成率", "='周度总表'!K5", ">=95%", "=IF(B13>=0.95,\"通过\",\"需关注\")", "细标签强结论建议达到 95%"],
    ["可比周期数", "='周度总表'!X5", ">=2 开启环比；>=4 写趋势", "=IF(B14>=4,\"趋势可用\",IF(B14>=2,\"仅环比可用\",\"未开启\"))", "当前不作环比或趋势结论"],
    ["待复核关系", "='周度总表'!U5", "=0", "=IF(B15=0,\"通过\",\"需处理\")", "关系影响实体、事件与标签归属"],
  ];
  qualityRows.forEach((row, index) => {
    const target = 12 + index;
    sheet.getRange(`A${target}`).values = [[row[0]]];
    sheet.getRange(`B${target}`).formulas = [[row[1]]];
    sheet.getRange(`C${target}`).values = [[row[2]]];
    sheet.getRange(`D${target}`).formulas = [[row[3]]];
    sheet.getRange(`E${target}`).values = [[row[4]]];
  });
  styleBody(sheet.getRange("A12:E15"), { wrap: true });
  sheet.getRange("B13:B13").format.numberFormat = "0.0%";
  sheet.getRange("12:15").format.rowHeight = 32;
  sheet.getRange("D12:D15").conditionalFormats.add("containsText", {
    text: "通过",
    format: { fill: colors.greenPale, font: { color: colors.green, bold: true } },
  });
  sheet.getRange("D12:D15").conditionalFormats.add("containsText", {
    text: "需",
    format: { fill: colors.redPale, font: { color: colors.red, bold: true } },
  });
  sheet.getRange("D12:D15").conditionalFormats.add("containsText", {
    text: "未开启",
    format: { fill: colors.yellowPale, font: { color: colors.ink, bold: true } },
  });

  const reviewHeaderRow = 18;
  mergeWrite(sheet, `A${reviewHeaderRow - 1}:K${reviewHeaderRow - 1}`, `复核队列（${orderedReviews.length} 条）`, {
    fill: colors.orange,
    font: { bold: true, color: colors.white, size: 11 },
    verticalAlignment: "center",
  });
  const reviewColumns = [
    ["priority", "优先级"], ["review_type", "复核类型"], ["source_table", "来源表"], ["object_id", "对象ID"],
    ["object_name", "对象名称"], ["current_status", "当前状态"], ["issue", "问题"], ["suggested_action", "建议动作"],
    ["period_id", "周期"], ["review_item_id", "复核项ID"], ["rule_version", "规则版本"],
  ];
  sheet.getRange(`A${reviewHeaderRow}:K${reviewHeaderRow}`).values = [reviewColumns.map((item) => item[1])];
  styleSectionHeader(sheet.getRange(`A${reviewHeaderRow}:K${reviewHeaderRow}`), colors.orange);
  const reviewFirst = reviewHeaderRow + 1;
  const reviewLast = reviewHeaderRow + Math.max(1, orderedReviews.length);
  if (orderedReviews.length) {
    sheet.getRangeByIndexes(reviewFirst - 1, 0, orderedReviews.length, reviewColumns.length).values = orderedReviews.map((record) => reviewColumns.map(([key]) => record[key] ?? null));
    styleBody(sheet.getRange(`A${reviewFirst}:K${reviewLast}`), { wrap: true });
    sheet.getRange(`${reviewFirst}:${reviewLast}`).format.rowHeight = 48;
    const queueTable = sheet.tables.add(`A${reviewHeaderRow}:K${reviewLast}`, true, "ReviewQueueV12");
    queueTable.style = "TableStyleLight1";
    queueTable.showFilterButton = true;
    styleSectionHeader(sheet.getRange(`A${reviewHeaderRow}:K${reviewHeaderRow}`), colors.orange);
    sheet.getRange(`A${reviewFirst}:A${reviewLast}`).conditionalFormats.add("containsText", {
      text: "high",
      format: { fill: colors.redPale, font: { color: colors.red, bold: true } },
    });
    sheet.getRange(`F${reviewFirst}:F${reviewLast}`).conditionalFormats.add("containsText", {
      text: "needs",
      format: { fill: colors.yellowPale, font: { color: colors.ink, bold: true } },
    });
  } else {
    mergeWrite(sheet, `A${reviewFirst}:K${reviewFirst}`, "当前无待复核项；已决议的复核记录保留在 resolved_review_decisions.csv，不回填为待办。", {
      fill: colors.greenPale,
      font: { color: colors.green, bold: true, size: 10 },
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "outside", style: "thin", color: colors.line },
    });
    sheet.getRange(`${reviewFirst}:${reviewFirst}`).format.rowHeight = 38;
  }
  const qualityWidths = [12, 16, 19, 34, 34, 20, 44, 44, 13, 40, 18];
  qualityWidths.forEach((width, index) => { sheet.getRange(`${colLetter(index)}:${colLetter(index)}`).format.columnWidth = width; });
  sheet.freezePanes.freezeRows(reviewHeaderRow);
  sheet.freezePanes.freezeColumns(2);
  inspectionRanges.set("质量与复核", `A1:K${reviewLast}`);
}

// 明细导航
{
  const sheet = workbook.worksheets.getItem("明细导航");
  const inventory = [
    ["mart_weekly_overview", "周度官方总口径", weekly.length, "周期", "period_id", "品牌事实层", path.relative(ROOT, paths.weekly)],
    ["mart_theme_metrics", "核心主题指标", themes.length, "周期×主题", "period_id+theme_id", "品牌事实层", path.relative(ROOT, paths.themes)],
    ["mart_tag_metrics", "细标签指标", tags.length, "周期×标签", "period_id+tag_id", "品牌事实层", path.relative(ROOT, paths.tags)],
    ["mart_product_category", "品类指标", categories.length, "周期×品类", "period_id+category_code", "品牌事实层", path.relative(ROOT, paths.categories)],
    ["mart_ingredient", "原料/产品元素指标", ingredients.length, "周期×实体", "period_id+entity_id", "品牌事实层", path.relative(ROOT, paths.ingredients)],
    ["mart_collaboration", "联名方/IP指标", collaborations.length, "周期×实体", "period_id+entity_id", "品牌事实层", path.relative(ROOT, paths.collaborations)],
    ["mart_promotion", "促销机制汇总", promotionMetrics.length, "周期×来源层×机制", "period_id+source_class+promotion_type", "官方/发现层分开", path.relative(ROOT, paths.promotionMetrics)],
    ["fact_promotion_offers", "逐条促销证据", promotionDetails.length, "促销证据", "promotion_id", "官方/发现层分开", path.relative(ROOT, paths.promotionDetails)],
    ["mart_brand_metrics", "品牌指标", brands.length, "周期×品牌", "period_id+brand_id", "品牌事实层", path.relative(ROOT, paths.brands)],
    ["mart_hotspot", "近 7 日编辑热点", hotspots.length, "周期×选题", "period_id+topic_id", "编辑参考层", path.relative(ROOT, paths.hotspots)],
    ["analysis_insights", "分析结论与边界", insights.length, "周期×结论", "insight_id", "分析层", path.relative(ROOT, paths.insights)],
    ["tag_review_queue", "待人工复核队列", reviewQueue.length, "复核项", "review_item_id", "质量层", path.relative(ROOT, paths.reviewQueue)],
    ["字段字典_V1.2", "字段含义与校验", fieldDictionary.length, "表×字段", "table_name+field_name", "治理层", path.relative(ROOT, paths.fieldDictionary)],
    ["指标字典_V1.2", "指标公式与解读", metricDictionary.length, "指标", "metric_id", "治理层", path.relative(ROOT, paths.metricDictionary)],
    ["标签字典_V1.2", "标签定义、边界与版本", tagDictionary.length, "标签", "tag_id", "治理层", path.relative(ROOT, paths.tagDictionary)],
  ].map((row) => ({ name: row[0], purpose: row[1], row_count: row[2], grain: row[3], primary_key: row[4], source_layer: row[5], file_path: row[6] }));
  writeDataSheet({
    name: "明细导航",
    title: "明细导航｜每张表在哪里、解决什么",
    note: "工作簿只做阅读与复核入口；CSV/JSON 是机器可追溯的单一来源，不要在 Excel 中手工改写统计结果。",
    records: inventory,
    tableName: "DataInventoryV12",
    freezeColumns: 2,
    columns: [
      { key: "name", label: "表名", width: 28 },
      { key: "purpose", label: "用途", width: 34, wrap: true },
      { key: "row_count", label: "数据行数", width: 12, numberFormat: "#,##0" },
      { key: "grain", label: "粒度", width: 24 },
      { key: "primary_key", label: "主键/唯一键", width: 32 },
      { key: "source_layer", label: "来源层", width: 24 },
      { key: "file_path", label: "文件位置", width: 75, wrap: true },
    ],
    rowHeight: 38,
  });
}

writeDataSheet({
  name: "字段字典",
  title: "字段字典｜数型、血缘与校验规则",
  note: "新增或修改字段时，先更新本字典及版本，再修改生成脚本和页面。",
  records: fieldDictionary,
  tableName: "FieldDictionaryV12",
  columns: [
    { key: "table_name", label: "表名", width: 29 },
    { key: "field_name", label: "字段名", width: 30 },
    { key: "data_type", label: "数据类型", width: 15 },
    { key: "required", label: "必填", width: 9, center: true },
    { key: "description", label: "字段含义", width: 38, wrap: true },
    { key: "lineage", label: "数据血缘", width: 36, wrap: true },
    { key: "validation_rule", label: "校验规则", width: 40, wrap: true },
    { key: "rule_version", label: "规则版本", width: 20 },
  ],
  rowHeight: 38,
});

writeDataSheet({
  name: "指标字典",
  title: "指标字典｜公式、粒度与解读边界",
  note: "指标必须有稳定 ID、口径、来源层和版本；模型只负责判断与写作，不负责计算指标。",
  records: metricDictionary,
  tableName: "MetricDictionaryV12",
  columns: [
    { key: "metric_id", label: "指标ID", width: 32 },
    { key: "metric_name", label: "指标名", width: 26 },
    { key: "formula", label: "公式", width: 48, wrap: true },
    { key: "grain", label: "粒度", width: 22 },
    { key: "source_scope", label: "来源范围", width: 22 },
    { key: "metric_role", label: "指标角色", width: 16 },
    { key: "interpretation_rule", label: "解读规则", width: 50, wrap: true },
    { key: "version", label: "版本", width: 20 },
  ],
  rowHeight: 38,
});

writeDataSheet({
  name: "标签字典",
  title: "标签字典｜定义、包含/排除与复核门槛",
  note: "模型产出的标签只是建议；达到置信门槛并经人工复核后，才能进入正式 BI 指标。",
  records: tagDictionary,
  tableName: "TagDictionaryV12",
  freezeColumns: 3,
  columns: [
    { key: "tag_id", label: "标签ID", width: 34 },
    { key: "tag_name", label: "标签名", width: 26 },
    { key: "dimension", label: "标签维度", width: 18 },
    { key: "parent_tag_id", label: "父标签ID", width: 30 },
    { key: "definition", label: "定义", width: 42, wrap: true },
    { key: "inclusion_rule", label: "包含规则", width: 46, wrap: true },
    { key: "exclusion_rule", label: "排除规则", width: 46, wrap: true },
    { key: "positive_example", label: "正例", width: 36, wrap: true },
    { key: "negative_example", label: "反例", width: 36, wrap: true },
    { key: "object_grain", label: "打标粒度", width: 15 },
    { key: "source_scope", label: "来源范围", width: 18 },
    { key: "cardinality", label: "单/多选", width: 13 },
    { key: "decision_method", label: "判定方式", width: 34, wrap: true },
    { key: "confidence_threshold", label: "置信门槛", width: 24, wrap: true },
    { key: "status", label: "状态", width: 13 },
    { key: "version", label: "版本", width: 20 },
    { key: "effective_from", label: "生效日期", width: 15, numberFormat: "yyyy-mm-dd" },
    { key: "change_reason", label: "变更原因", width: 42, wrap: true },
  ],
  rowHeight: 52,
  statusKeys: ["status"],
});

await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await fs.mkdir(PREVIEW_DIR, { recursive: true });

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(OUTPUT_FILE);

// 重新打开最终文件，对每张表执行紧凑的全区域 inspect、公式错误扫描和全表渲染。
const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(OUTPUT_FILE));
const sheetSummary = await reopened.inspect({ kind: "sheet", include: "id,name", maxChars: 12000 });
console.log("SHEET_SUMMARY");
console.log(sheetSummary.ndjson);

for (const [index, name] of sheetNames.entries()) {
  const range = inspectionRanges.get(name);
  if (!range) throw new Error(`Missing inspection range for sheet ${name}`);
  const inspection = await reopened.inspect({
    kind: "region",
    sheetId: name,
    range,
    include: "values,formulas",
    tableMaxRows: 250,
    tableMaxCols: 40,
    maxChars: 8000,
  });
  if (!inspection.ndjson) throw new Error(`Empty inspection output for ${name}`);
  console.log(`INSPECT_OK ${name} ${range}`);
  const preview = await reopened.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
  const previewName = `${String(index + 1).padStart(2, "0")}_${sanitizeFileName(name)}.png`;
  await fs.writeFile(path.join(PREVIEW_DIR, previewName), new Uint8Array(await preview.arrayBuffer()));
  console.log(`RENDER_OK ${name} ${previewName}`);
}

const formulaErrors = await reopened.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "V1.2 workbook final formula error scan",
  maxChars: 12000,
});
console.log("FORMULA_ERROR_SCAN");
console.log(formulaErrors.ndjson);
await fs.rm(`${OUTPUT_FILE}.inspect.ndjson`, { force: true });
console.log(`OUTPUT_FILE ${OUTPUT_FILE}`);
console.log(`PREVIEW_DIR ${PREVIEW_DIR}`);
