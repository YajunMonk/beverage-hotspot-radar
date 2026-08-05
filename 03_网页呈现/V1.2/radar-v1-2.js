(() => {
  "use strict";

  const DATA = window.RADAR_V12_DATA;
  if (!DATA) {
    document.body.innerHTML = "<main style='padding:40px;font-family:sans-serif'>V1.2 数据文件未正确载入，请确认 radar-v1-2-data.js 与页面位于同一目录。</main>";
    return;
  }

  const BI = DATA.bi;
  if (!BI?.overview) {
    document.body.innerHTML = "<main style='padding:40px;font-family:sans-serif'>V1.2 BI 数据契约缺失，页面停止渲染以避免展示错误数字。</main>";
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const safeUrl = (value) => /^https:\/\/www\.xiaohongshu\.com\//.test(value || "") ? value : "#";
  const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const formatNumber = (value) => hasNumber(value) ? Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
  const formatPercent = (value) => hasNumber(value) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
  const shortDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
  };
  const fullDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const themeIds = (record) => unique(
    record?.theme_ids
    || record?.theme_assignments?.map((item) => item.theme_id)
    || []
  );

  const eventMap = new Map(DATA.events.map((item) => [item.event_id, item]));
  const contentMap = new Map(DATA.contents.map((item) => [item.content_id, item]));
  const entityMap = new Map(DATA.entities.map((item) => [item.entity_id, item]));
  const relationsByEvent = new Map();
  const relationsByContent = new Map();
  const biEventMetricMap = new Map((BI.event_metrics || []).map((item) => [item.event_id, item]));
  const biThemeMetricMap = new Map((BI.themes || []).map((item) => [item.theme_id, item]));
  const biTagMetricMap = new Map((BI.tags || []).map((item) => [item.tag_id, item]));
  for (const relation of DATA.relations) {
    if (!relationsByEvent.has(relation.event_id)) relationsByEvent.set(relation.event_id, []);
    if (!relationsByContent.has(relation.content_id)) relationsByContent.set(relation.content_id, []);
    relationsByEvent.get(relation.event_id).push(relation);
    relationsByContent.get(relation.content_id).push(relation);
  }

  const themeAnalyses = DATA.summary.theme_analyses || [];
  const themeMap = new Map(themeAnalyses.map((item) => [item.theme_id, item]));
  const coreTagMap = new Map(
    themeAnalyses.flatMap((analysis) =>
      (analysis.tags || []).map((tag) => [
        tag.tag_id,
        {
          ...tag,
          theme_ids: unique(tag.theme_ids?.length ? tag.theme_ids : [analysis.theme_id]),
        },
      ])
    )
  );

  function renderThemeTags(record) {
    return themeIds(record).map((themeId) => {
      const assignment = record.theme_assignments?.find((item) => item.theme_id === themeId);
      const label = themeMap.get(themeId)?.label || assignment?.label || themeId;
      return `<span class="tag core-theme-tag theme-tone-${escapeHtml(themeId)}">${escapeHtml(label)}</span>`;
    }).join("");
  }

  function renderOriginalActionTag(event) {
    const themeLabels = new Set(themeIds(event).map((themeId) => themeMap.get(themeId)?.label).filter(Boolean));
    return themeLabels.has(event.action.level1_label)
      ? ""
      : `<span class="tag">${escapeHtml(event.action.level1_label)}</span>`;
  }

  const entityTypeLabels = {
    product_name: "具体产品",
    product_series: "产品系列",
    product_element: "产品元素",
    collab_partner: "合作对象",
    collab_project: "合作项目",
    merch_item: "具体周边",
    occasion: "营销节点",
    person: "人物",
    location: "地点",
    campaign_name: "活动主题",
    process_claim: "工艺／产品技术",
  };

  const roleLabels = {
    primary: "核心主角",
    secondary: "次要元素",
    context: "关联背景",
    comment_signal: "评论线索",
  };

  const signalLabels = {
    trend_candidate: "趋势候选",
    cross_brand_signal: "跨品牌信号",
    single_brand_case: "单品牌案例",
  };

  const discovery = DATA.discovery_signals || { source_classes: [], selected_koc_sources: [], signals: [] };
  const sourceClassLabels = new Map([
    ["brand", "品牌"],
    ["third_party", "三方"],
    ["koc", "KOC"],
    ...discovery.source_classes.map((item) => [item.source_class, item.label]),
  ]);
  const allSignals = [
    ...DATA.events.map((event) => ({ ...event, source_class: "brand", signal_kind: "brand_event" })),
    ...discovery.signals,
  ];

  const state = {
    sourceClass: new Set(),
    brand: new Set(),
    coreTheme: new Set(),
    coreTag: new Set(),
    category: new Set(),
    module: new Set(),
    entityType: new Set(),
    verification: new Set(),
    entityQuery: "",
  };

  let visibleEvents = [...allSignals];
  let eventVisibleLimit = 12;
  let contentVisibleLimit = 12;
  let lastEventTrigger = null;

  function bestEventEntityRows(event, includeContext = false) {
    const rank = { primary: 0, secondary: 1, context: 2, comment_signal: 3 };
    const byEntity = new Map();
    for (const relation of relationsByEvent.get(event.event_id) || []) {
      if (!includeContext && !["primary", "secondary"].includes(relation.role)) continue;
      const previous = byEntity.get(relation.entity_id);
      if (!previous || rank[relation.role] < rank[previous.role]) byEntity.set(relation.entity_id, relation);
    }
    return [...byEntity.values()]
      .map((relation) => ({ ...relation, entity: entityMap.get(relation.entity_id) }))
      .filter((item) => item.entity)
      .sort((a, b) =>
        rank[a.role] - rank[b.role]
        || (b.entity.metrics?.event_count || 0) - (a.entity.metrics?.event_count || 0)
        || a.entity.canonical_name.localeCompare(b.entity.canonical_name, "zh-CN"));
  }

  function eventDimensionValues(event, dimension) {
    if (dimension === "sourceClass") return [event.source_class || "brand"];
    if (dimension === "brand") return [event.primary_brand_id];
    if (dimension === "coreTheme") return themeIds(event);
    if (dimension === "category") return unique((event.product_categories || []).map((item) => item.level2_code));
    if (dimension === "module") return event.business_modules || [];
    if (dimension === "entityType") return unique((event.entity_ids || []).map((id) => entityMap.get(id)?.entity_type));
    if (dimension === "verification") return event.verification_status ? [event.verification_status] : [];
    return [];
  }

  function matchesSet(values, selected) {
    return selected.size === 0 || values.some((value) => selected.has(value));
  }

  function eventMatchesQuery(event, query) {
    if (!query) return true;
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return true;
    if (event.signal_kind === "post") {
      return [
        event.title,
        event.summary,
        event.source_name,
        event.primary_brand_name,
        ...(event.topic_tags || []),
      ].join(" ").toLocaleLowerCase("zh-CN").includes(normalized);
    }
    return (event.entity_ids || []).some((id) => {
      const entity = entityMap.get(id);
      if (!entity) return false;
      const haystack = [
        entity.canonical_name,
        ...(entity.aliases || []),
        ...(entity.raw_mentions || []),
      ].join(" ").toLocaleLowerCase("zh-CN");
      return haystack.includes(normalized);
    });
  }

  function filterEvents() {
    visibleEvents = allSignals.filter((event) =>
      matchesSet(eventDimensionValues(event, "sourceClass"), state.sourceClass)
      && matchesSet(eventDimensionValues(event, "brand"), state.brand)
      && matchesSet(eventDimensionValues(event, "coreTheme"), state.coreTheme)
      && matchesSet(event.tag_ids || [], state.coreTag)
      && matchesSet(eventDimensionValues(event, "category"), state.category)
      && matchesSet(eventDimensionValues(event, "module"), state.module)
      && matchesSet(eventDimensionValues(event, "entityType"), state.entityType)
      && matchesSet(eventDimensionValues(event, "verification"), state.verification)
      && eventMatchesQuery(event, state.entityQuery)
    );
    visibleEvents.sort((a, b) => {
      const leftDate = a.latest_at || a.published_at || "";
      const rightDate = b.latest_at || b.published_at || "";
      return rightDate.localeCompare(leftDate)
        || String(a.event_id || a.signal_id).localeCompare(String(b.event_id || b.signal_id));
    });
  }

  function optionList(dimension, labels) {
    const countMap = new Map();
    for (const event of allSignals) {
      for (const value of unique(eventDimensionValues(event, dimension))) {
        countMap.set(value, (countMap.get(value) || 0) + 1);
      }
    }
    return [...countMap.entries()]
      .map(([value, count]) => ({ value, label: labels.get(value) || value, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
  }

  function buildFilterConfig() {
    const brandLabels = new Map(DATA.brands.map((item) => [item.brand_id, item.brand_name]));
    const themeLabels = new Map(themeAnalyses.map((item) => [item.theme_id, item.label]));
    const categoryLabels = new Map();
    const moduleLabels = new Map();
    const entityTypeMap = new Map();
    const verificationLabels = new Map();
    for (const event of allSignals) {
      if (event.primary_brand_id && event.primary_brand_name) brandLabels.set(event.primary_brand_id, event.primary_brand_name);
      (event.product_categories || []).forEach((item) => categoryLabels.set(item.level2_code, item.level2_label));
      (event.business_modules || []).forEach((item) => moduleLabels.set(item, item));
      (event.entity_ids || []).forEach((id) => {
        const entity = entityMap.get(id);
        if (entity) entityTypeMap.set(entity.entity_type, entityTypeLabels[entity.entity_type] || entity.entity_type);
      });
      if (event.verification_status) verificationLabels.set(event.verification_status, event.verification_status);
    }
    return [
      { dimension: "entityQuery", title: "关键词搜索", type: "search", open: true },
      { dimension: "sourceClass", title: "来源", options: optionList("sourceClass", sourceClassLabels), open: true },
      { dimension: "coreTheme", title: "本周主线", options: optionList("coreTheme", themeLabels), open: true },
      { dimension: "brand", title: "品牌", options: optionList("brand", brandLabels), open: true },
      { dimension: "category", title: "产品品类", options: optionList("category", categoryLabels) },
      { dimension: "module", title: "关联业务模块", options: optionList("module", moduleLabels) },
      { dimension: "entityType", title: "实体类型", options: optionList("entityType", entityTypeMap) },
      { dimension: "verification", title: "核实状态", options: optionList("verification", verificationLabels) },
    ];
  }

  const filterConfig = buildFilterConfig();

  function renderFilterControls(container, prefix) {
    container.innerHTML = filterConfig.map((group) => {
      if (group.type === "search") {
        return `
          <details class="filter-group" ${group.open ? "open" : ""}>
            <summary>${escapeHtml(group.title)}</summary>
            <label class="filter-search">
              <span>支持标准名和原文名称</span>
              <input
                id="${prefix}-entity-search"
                data-filter-search="entityQuery"
                type="search"
                value="${escapeHtml(state.entityQuery)}"
                placeholder="蜘蛛侠、菠萝、Crocs"
                autocomplete="off"
              >
            </label>
          </details>`;
      }
      return `
        <details class="filter-group" ${group.open ? "open" : ""}>
          <summary>${escapeHtml(group.title)}</summary>
          <div class="filter-option-list">
            ${group.options.map((option) => `
              <label class="filter-option">
                <input
                  type="checkbox"
                  data-filter-dimension="${escapeHtml(group.dimension)}"
                  value="${escapeHtml(option.value)}"
                  ${state[group.dimension].has(option.value) ? "checked" : ""}
                >
                <span>${escapeHtml(option.label)}</span>
                <small>${option.count}</small>
              </label>`).join("")}
          </div>
        </details>`;
    }).join("");
  }

  function bindFilterControls(container) {
    container.addEventListener("change", (event) => {
      const input = event.target.closest("[data-filter-dimension]");
      if (!input) return;
      const dimension = input.dataset.filterDimension;
      if (input.checked) state[dimension].add(input.value);
      else state[dimension].delete(input.value);
      eventVisibleLimit = 12;
      contentVisibleLimit = 12;
      refreshResults();
      syncFilterControls();
    });
    container.addEventListener("input", (event) => {
      const input = event.target.closest("[data-filter-search]");
      if (!input) return;
      state.entityQuery = input.value;
      eventVisibleLimit = 12;
      contentVisibleLimit = 12;
      refreshResults();
      for (const peer of $$("[data-filter-search]")) {
        if (peer !== input && peer.value !== input.value) peer.value = input.value;
      }
    });
  }

  function syncFilterControls() {
    for (const input of $$("[data-filter-dimension]")) {
      const dimension = input.dataset.filterDimension;
      input.checked = state[dimension].has(input.value);
    }
    for (const input of $$("[data-filter-search]")) {
      if (input.value !== state.entityQuery) input.value = state.entityQuery;
    }
    for (const control of $$("[data-apply-theme]")) {
      const selected = state.coreTheme.has(control.dataset.applyTheme);
      control.setAttribute("aria-pressed", String(selected));
      control.toggleAttribute("data-selected", selected);
    }
    for (const control of $$("[data-apply-core-tag]")) {
      const selected = state.coreTag.has(control.dataset.applyCoreTag);
      control.setAttribute("aria-pressed", String(selected));
      control.toggleAttribute("data-selected", selected);
    }
  }

  function activeFilterCount() {
    return Object.entries(state).reduce((total, [key, value]) => {
      if (key === "entityQuery") return total + (value.trim() ? 1 : 0);
      return total + value.size;
    }, 0);
  }

  function clearFilterState({ resetContentControls = false } = {}) {
    Object.entries(state).forEach(([key, value]) => {
      if (key === "entityQuery") state[key] = "";
      else value.clear();
    });
    eventVisibleLimit = 12;
    contentVisibleLimit = 12;
    if (resetContentControls) {
      const contentSearch = $("#content-search");
      const contentSort = $("#content-sort");
      if (contentSearch) contentSearch.value = "";
      if (contentSort) contentSort.value = "latest";
    }
  }

  function resetFilters() {
    clearFilterState({ resetContentControls: true });
    syncFilterControls();
    refreshResults();
  }

  function scrollToEventLibrary() {
    const target = $("#events");
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  function applyTheme(themeId, tagId = "") {
    if (!themeMap.has(themeId)) return;
    clearFilterState({ resetContentControls: true });
    state.coreTheme.add(themeId);
    if (tagId && coreTagMap.get(tagId)?.theme_ids?.includes(themeId)) state.coreTag.add(tagId);
    syncFilterControls();
    refreshResults();
    scrollToEventLibrary();
  }

  function applySource(sourceClass) {
    if (!sourceClassLabels.has(sourceClass)) return;
    clearFilterState({ resetContentControls: true });
    state.sourceClass.add(sourceClass);
    syncFilterControls();
    refreshResults();
    scrollToEventLibrary();
  }

  function renderMetaAndStatus() {
    const overview = BI.overview;
    $("#release-period").textContent = overview.period_id.replace("2026-", "");
    $("#release-version").textContent = BI.release;
    $("#period-label").textContent = `本期监测 · ${overview.start_date.slice(5).replaceAll("-", ".")}—${overview.end_date.slice(5).replaceAll("-", ".")}`;
    $("#scope-summary").textContent = `${formatNumber(overview.active_brand_count)} 个品牌 · ${formatNumber(overview.unique_event_count)} 个事件`;
    $("#scope-source").textContent = `${formatNumber(overview.brand_content_count)} 条官号内容 + ${formatNumber(overview.discovery_signal_count)} 条外部线索`;
    $("#method-rule").textContent = overview.rule_version;
    $("#hero-lead").textContent = `${formatNumber(overview.brand_content_count)} 条品牌官号内容归并为 ${formatNumber(overview.unique_event_count)} 个市场事件，并补充 ${formatNumber(overview.discovery_signal_count)} 条 KOC / 三方线索。先看本周主线，再按需下钻案例和原帖。`;
    $("#method-scope").textContent = `本期正式统计覆盖 ${formatNumber(overview.active_brand_count)} 个品牌、${formatNumber(overview.brand_content_count)} 条官号内容和 ${formatNumber(overview.unique_event_count)} 个事件；三方 ${formatNumber(overview.third_party_post_count)} 条、KOC ${formatNumber(overview.koc_post_count)} 条只进入市场线索。`;
    $("#method-engagement").textContent = `点赞快照龄为 ${formatNumber(overview.snapshot_age_hours_min)}—${formatNumber(overview.snapshot_age_hours_max)} 小时，中位 ${formatNumber(overview.snapshot_age_hours_median)} 小时；没有曝光和粉丝基数，因此不计算互动率。`;
    $("#method-review").textContent = `当前事件细标签待复核 ${formatNumber(overview.pending_event_review_count)} 个、内容迁移字段待复核 ${formatNumber(overview.pending_content_review_count)} 条、实体关系待复核 ${formatNumber(overview.pending_relation_review_count)} 条，均已进入独立队列。`;

    const quality = BI.quality || {};
    const hasWarnings = Number(quality.warning_count || 0) > 0;
    const badge = $("#quality-badge");
    badge.textContent = hasWarnings ? `校验通过 · ${formatNumber(quality.warning_count)} 项限制` : "校验通过";
    badge.classList.toggle("has-warning", hasWarnings);
    $("#data-status-content").innerHTML = `
      <div><span>数据周期</span><strong>${escapeHtml(overview.start_date)}—${escapeHtml(overview.end_date)}</strong><small>当前仅 1 个可比周期，环比和趋势已禁用</small></div>
      <div><span>来源边界</span><strong>品牌事实层进入 KPI</strong><small>三方 ${formatNumber(overview.third_party_post_count)} 帖 · KOC ${formatNumber(overview.koc_post_count)} 帖 · 热点 ${formatNumber(overview.editorial_topic_count)} 条</small></div>
      <div><span>互动可比性</span><strong>快照龄中位 ${formatNumber(overview.snapshot_age_hours_median)} 小时</strong><small>最短 ${formatNumber(overview.snapshot_age_hours_min)} · 最长 ${formatNumber(overview.snapshot_age_hours_max)} 小时</small></div>
      <div><span>复核进度</span><strong>${formatPercent(overview.review_completion_rate)}</strong><small>${formatNumber(overview.pending_event_review_count)} 个事件细标签仍待确认</small></div>
      <div><span>质量状态</span><strong>0 个阻断错误</strong><small>${formatNumber(quality.warning_count)} 类限制已在质量报告中披露</small></div>`;
  }

  function renderBiOverview() {
    const overview = BI.overview;
    const cards = [
      ["市场事件", overview.unique_event_count, "个", `由 ${formatNumber(overview.brand_content_count)} 条品牌内容归并`],
      ["监测品牌", overview.active_brand_count, "个", "本期均有可回看的官号内容"],
      ["点赞中位数", overview.likes_median, "", "互动快照仅作为案例参考"],
    ];
    $("#bi-overview-grid").innerHTML = cards.map(([label, value, unit, note]) => `
      <article class="bi-kpi-card">
        <span>${escapeHtml(label)}</span>
        <strong>${formatNumber(value)}<small>${escapeHtml(unit)}</small></strong>
        <p>${escapeHtml(note)}</p>
      </article>`).join("");
    $("#bi-overview-note").textContent = `另有 ${formatNumber(overview.koc_post_count)} 条 KOC 体验和 ${formatNumber(overview.third_party_post_count)} 条三方线索，与品牌事实分开统计。`;
  }

  function marketThemeTakeaway(metric, tags) {
    const tagNames = unique(tags.map((tag) => tag.tag_name)).slice(0, 3);
    if (metric.theme_id === "product_action") {
      const topCategory = [...(BI.product_categories || [])]
        .filter((row) => Number(row.category_level) === 2 && row.category_name !== "非产品内容")
        .sort((a, b) => Number(b.event_count) - Number(a.event_count))[0];
      return `${topCategory?.category_name || "产品上新"}覆盖 ${formatNumber(topCategory?.event_count || metric.event_count)} 个事件，是本周最密集的产品方向；${tagNames.join("、")}反复出现。`;
    }
    if (metric.theme_id === "collaboration") {
      return `本周出现 ${formatNumber(metric.event_count)} 个联名事件，但前三个项目贡献约 ${Math.round(Number(metric.top3_event_content_share || 0) * 100)}% 的联名内容，热度明显集中在少数大项目。`;
    }
    return `门店、互动和品牌公共事件共 ${formatNumber(metric.event_count)} 个；单条表现波动较大，更适合看具体案例，不宜直接当成行业趋势。`;
  }

  function renderCoreThemes() {
    const themeSubtitles = {
      product_action: "新品、原料与产品更新",
      collaboration: "IP、跨界合作与联名产品",
      brand_event: "门店、互动与品牌动作",
    };
    $("#theme-analysis-grid").innerHTML = (BI.themes || []).map((metric, index) => {
      const analysis = themeMap.get(metric.theme_id) || {};
      const tags = (BI.tags || []).filter((tag) => tag.theme_id === metric.theme_id).sort((a, b) => a.display_order - b.display_order);
      const insight = (BI.insights || []).find((item) => item.insight_type === "theme" && item.subject_id === metric.theme_id);
      const featuredEvent = eventMap.get(metric.representative_event_id);
      const evidencePoints = String(insight?.evidence_points || "").split("｜").filter(Boolean);
      return `
        <article class="theme-analysis-card theme-tone-${escapeHtml(metric.theme_id)}" data-theme-card="${escapeHtml(metric.theme_id)}">
          <span class="theme-watermark" aria-hidden="true">${escapeHtml(analysis.decorative_alias || "")}</span>
          <header class="theme-card-header">
            <button
              class="theme-card-filter"
              type="button"
              data-apply-theme="${escapeHtml(metric.theme_id)}"
              aria-pressed="false"
              aria-describedby="theme-summary-${escapeHtml(metric.theme_id)}"
              aria-label="筛选${escapeHtml(metric.theme_label)}，涉及${metric.event_count}个事件"
            >
              <span class="theme-card-heading">
                <span>
                  <span class="theme-card-index">0${index + 1}</span>
                  <span class="theme-card-title">${escapeHtml(metric.theme_label)}</span>
                </span>
                <small>${escapeHtml(themeSubtitles[metric.theme_id] || analysis.subtitle || "")}</small>
              </span>
              <span class="theme-card-count"><strong>${metric.event_count}</strong><small>个事件</small></span>
            </button>
          </header>
          <div id="theme-summary-${escapeHtml(metric.theme_id)}" class="theme-analysis-copy">
            <strong class="theme-analysis-lead">${escapeHtml(marketThemeTakeaway(metric, tags))}</strong>
          </div>
          ${featuredEvent ? `
            <button
              class="theme-featured-event"
              type="button"
              data-open-event="${escapeHtml(featuredEvent.event_id)}"
              aria-label="查看${escapeHtml(metric.theme_label)}代表事件：${escapeHtml(featuredEvent.standard_name)}"
            >
              <span class="theme-featured-label">本周代表案例</span>
              <strong>${escapeHtml(featuredEvent.standard_name)}</strong>
              <small>${escapeHtml(featuredEvent.primary_brand_name)} · ${featuredEvent.evidence_count} 条官号证据 <b>查看案例 ↗</b></small>
            </button>` : ""}
          <div class="theme-tag-list" aria-label="${escapeHtml(metric.theme_label)}重点标签">
            ${tags.slice(0, 4).map((tag) => `
              <button
                type="button"
                data-apply-core-tag="${escapeHtml(tag.tag_id)}"
                data-theme-id="${escapeHtml(metric.theme_id)}"
                aria-pressed="false"
                aria-label="查看${escapeHtml(metric.theme_label)}中的${escapeHtml(tag.tag_name)}，${tag.event_count}个事件，中位点赞${formatNumber(tag.likes_median)}"
              >
                <span class="theme-tag-main">
                  <span>${escapeHtml(tag.tag_name)}</span>
                  <strong>${tag.event_count}个事件</strong>
                </span>
                <small>${formatNumber(tag.active_brand_count)} 个品牌 · 互动中位 ${formatNumber(tag.likes_median)}</small>
              </button>`).join("")}
          </div>
          <details class="theme-data-details">
            <summary>查看数据依据</summary>
            <div class="theme-metric-strip" aria-label="${escapeHtml(metric.theme_label)}统计指标">
              <span><small>内容</small><strong>${formatNumber(metric.content_count)}</strong></span>
              <span><small>品牌</small><strong>${formatNumber(metric.active_brand_count)}</strong></span>
              <span><small>有互动数据</small><strong>${formatNumber(metric.likes_valid_count)}</strong></span>
              <span><small>中位数</small><strong>${formatNumber(metric.likes_median)}</strong></span>
              <span><small>高表现参考线</small><strong>${formatNumber(metric.likes_p75)}</strong></span>
              <span class="aux"><small>均值·辅助</small><strong>${formatNumber(metric.likes_mean)}</strong></span>
            </div>
            ${evidencePoints.length ? `<ul class="theme-evidence-points">${evidencePoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
            <p>${escapeHtml(insight?.boundary_note || metric.metric_scope)}</p>
          </details>
        </article>`;
    }).join("");
  }

  function renderTagMetrics() {
    const rows = [...(BI.tags || [])].sort((a, b) => a.display_order - b.display_order);
    const popularRows = [...new Map(
      [...rows]
        .sort((a, b) => Number(b.event_count) - Number(a.event_count)
          || Number(b.active_brand_count) - Number(a.active_brand_count)
          || Number(a.display_order) - Number(b.display_order))
        .map((row) => [row.tag_name, row])
    ).values()].slice(0, 8);
    $("#popular-tag-list").innerHTML = popularRows.map((row, index) => `
      <button
        class="popular-tag-button"
        type="button"
        data-apply-core-tag="${escapeHtml(row.tag_id)}"
        data-theme-id="${escapeHtml(row.theme_id)}"
        aria-pressed="false"
        aria-label="查看热门标签${escapeHtml(row.tag_name)}，${formatNumber(row.event_count)}个事件"
      >
        <span><i>${String(index + 1).padStart(2, "0")}</i>#${escapeHtml(row.tag_name)}</span>
        <strong>${formatNumber(row.event_count)} 个事件</strong>
        <small>${formatNumber(row.active_brand_count)} 个品牌</small>
      </button>`).join("");
    $("#tag-metric-table").innerHTML = `
      <div class="tag-metric-row tag-metric-head" role="row">
        <span>标签</span><span>维度</span><span>事件</span><span>内容</span><span>品牌</span><span>有效 N</span><span>中位数</span><span>P75</span><span>状态</span>
      </div>
      ${rows.map((row) => `
        <button class="tag-metric-row" type="button" role="row" data-apply-core-tag="${escapeHtml(row.tag_id)}" data-theme-id="${escapeHtml(row.theme_id)}" aria-label="筛选${escapeHtml(row.tag_name)}">
          <strong data-label="标签">${escapeHtml(row.tag_name)}<small>${escapeHtml(row.theme_label)}</small></strong>
          <span data-label="维度">${escapeHtml(row.tag_dimension)}</span>
          <span data-label="事件">${formatNumber(row.event_count)}</span>
          <span data-label="内容">${formatNumber(row.content_count)}</span>
          <span data-label="品牌">${formatNumber(row.active_brand_count)}</span>
          <span data-label="有效 N">${formatNumber(row.likes_valid_count)}</span>
          <span data-label="中位数">${formatNumber(row.likes_median)}</span>
          <span data-label="P75">${formatNumber(row.likes_p75)}</span>
          <span data-label="状态" class="sample-status ${row.sample_flag === "small_sample" ? "small" : ""}">${row.sample_flag === "small_sample" ? "小样本" : row.review_status === "approved" ? "已复核" : "暂行"}</span>
        </button>`).join("")}`;
  }

  function renderBreakdowns() {
    const panels = [
      { title: "产品品类", subtitle: "二级品类 · 事件数", rows: (BI.product_categories || []).filter((row) => row.category_level === 2).slice(0, 7), name: "category_name" },
      { title: "原料 / 产品元素", subtitle: "优先看跨品牌覆盖", rows: (BI.ingredients || []).filter((row) => row.event_count >= 2).slice(0, 7), name: "entity_name" },
      { title: "联名对象", subtitle: "具体IP与跨界品牌", rows: (BI.collaborations || []).slice(0, 7), name: "entity_name" },
    ];
    $("#breakdown-grid").innerHTML = panels.map((panel) => {
      const max = Math.max(...panel.rows.map((row) => Number(row.event_count || 0)), 1);
      return `<article class="breakdown-panel">
        <header><h3>${escapeHtml(panel.title)}</h3><span>${escapeHtml(panel.subtitle)}</span></header>
        <div class="breakdown-list">
          ${panel.rows.map((row) => `
            <div class="breakdown-row">
              <div><strong>${escapeHtml(row[panel.name])}</strong><span>${formatNumber(row.event_count)} 个事件 · ${formatNumber(row.active_brand_count)} 个品牌</span></div>
              <div class="breakdown-bar"><i style="width:${Math.max(6, Number(row.event_count || 0) / max * 100)}%"></i></div>
              <small>互动中位 ${formatNumber(row.likes_median)}</small>
            </div>`).join("")}
        </div>
      </article>`;
    }).join("");
  }

  function renderPromotions() {
    const promotions = BI.promotions || [];
    const official = promotions
      .filter((row) => row.included_in_official_kpi)
      .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")));
    const discoveryRows = promotions.filter((row) => !row.included_in_official_kpi);
    const featured = [...official.slice(0, 3), ...discoveryRows.slice(0, 1)];
    const featuredIds = new Set(featured.map((row) => row.promotion_id));
    const remaining = [...official, ...discoveryRows].filter((row) => !featuredIds.has(row.promotion_id));
    const cardMarkup = (row) => `
      <article class="promotion-card ${row.included_in_official_kpi ? "official" : "discovery"}">
        <div><span>${row.included_in_official_kpi ? "官号已核实" : "三方待确认"}</span><em>${escapeHtml(row.promotion_type)}</em></div>
        <h3>${escapeHtml(row.primary_brand_name)} · ${escapeHtml(row.mechanism)}</h3>
        <p>${escapeHtml(row.evidence_note)}</p>
        <footer><small>${row.start_date ? `${escapeHtml(row.start_date)}${row.end_date ? `—${escapeHtml(row.end_date)}` : ""}` : "活动时间待补"}</small><a href="${escapeHtml(safeUrl(row.canonical_url))}" target="_blank" rel="noopener noreferrer">查看原帖 ↗</a></footer>
      </article>`;
    $("#promotion-content").innerHTML = `
      <div class="promotion-summary">
        <article><span>官号已核实</span><strong>${formatNumber(BI.overview.promotion_official_count)}</strong><small>条优惠机制 · 涉及 ${formatNumber(new Set(official.map((row) => row.primary_brand_id)).size)} 个品牌</small></article>
        <article class="discovery"><span>三方待确认</span><strong>${formatNumber(BI.overview.promotion_discovery_count)}</strong><small>条低价线索 · 暂不作为品牌事实</small></article>
      </div>
      <div class="promotion-list">
        ${featured.map(cardMarkup).join("")}
      </div>
      ${remaining.length ? `
        <details class="promotion-more full-data-disclosure">
          <summary><span>查看全部优惠记录</span><small>其余 ${remaining.length} 条已保留</small></summary>
          <div class="promotion-list">${remaining.map(cardMarkup).join("")}</div>
        </details>` : ""}`;
  }

  function renderEditorialWatch() {
    const container = $("#editorial-watch-content");
    if (!container) return;

    const reference = DATA.editorial_reference || {};
    const sources = reference.sources || [];
    const topics = [...(BI.hotspots || [])].sort((a, b) => Number(a.display_rank || 999) - Number(b.display_rank || 999));
    const sourceById = new Map(sources.map((source) => [source.source_id, source]));
    const windowLabel = reference.editorial_window?.label || "最近 7 天";
    const otherHotspots = [...new Map(
      topics.flatMap((topic) => String(topic.other_hot_phrases || "").split("｜").filter(Boolean).map((tag) => {
        const label = String(tag).trim();
        return [label, {
          label,
          topicId: topic.topic_id,
          topicTitle: topic.title,
          postUrl: topic.canonical_url,
        }];
      }))
    ).values()].slice(0, 10);

    const topicMarkup = topics.length
      ? `<ol class="editorial-rank-list editorial-explained-list" aria-label="近7天热点选题与解释">
          ${topics.map((topic, index) => {
            const source = sourceById.get(topic.source_id);
            const likes = formatNumber(topic.likes);
            const rank = Number(topic.display_rank || index + 1);
            return `<li class="editorial-rank-item">
              <div class="editorial-explained-card">
                <span class="editorial-rank-number" aria-hidden="true">${String(rank).padStart(2, "0")}</span>
                <div class="editorial-rank-body">
                  <span class="editorial-topic-tags">
                    ${String(topic.topic_tags || "").split("｜").filter(Boolean).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
                  </span>
                  <strong class="hot-phrase">“${escapeHtml(topic.hot_phrase)}”</strong>
                  <dl class="hotspot-explanation">
                    <div><dt>这是什么意思</dt><dd>${escapeHtml(topic.plain_explanation)}</dd></div>
                    <div><dt>品牌可以怎么用</dt><dd>${escapeHtml(topic.brand_application)}</dd></div>
                  </dl>
                  <span class="editorial-topic-meta">
                    ${escapeHtml(source?.account_name || "热点来源")} · ${shortDate(topic.published_at)} 发布 · ${shortDate(topic.captured_at)} 抓取
                  </span>
                  <details class="hotspot-context">
                    <summary>查看来源背景</summary>
                    <span class="editorial-topic-title">来源标题：${escapeHtml(topic.title)}</span>
                    <p><strong>为什么现在出现：</strong>${escapeHtml(topic.why_now)}</p>
                    <p class="hotspot-boundary">${escapeHtml(topic.boundary_note)}</p>
                  </details>
                  <a class="editorial-open-source" href="${escapeHtml(safeUrl(topic.canonical_url))}" target="_blank" rel="noopener noreferrer" data-editorial-topic-source="${escapeHtml(topic.topic_id)}">打开可见原帖 ↗</a>
                </div>
                <span class="editorial-heat" aria-label="${likes}个赞">
                  <span aria-hidden="true">🔥</span><strong>${likes}</strong><small>点赞</small>
                </span>
              </div>
            </li>`;
          }).join("")}
        </ol>`
      : `<div class="editorial-empty-state">
          <span class="editorial-status-dot" aria-hidden="true"></span>
          <div>
            <strong>近 7 天热点帖子待抓取复核</strong>
            <p>本轮尚未取得可核对的帖子与点赞快照。完成抓取、直达链接验证和人工确认后，将在这里按点赞热度展示事件、标签与原帖入口。</p>
          </div>
        </div>`;

    const otherHotspotMarkup = otherHotspots.length
      ? `<section class="editorial-other-hotspots" aria-labelledby="editorial-other-hotspots-heading">
          <div class="editorial-other-hotspots-copy">
            <h3 id="editorial-other-hotspots-heading">其他热点</h3>
            <p>点击直达对应笔记；排序不等同于平台全站热榜。</p>
          </div>
          <ul class="editorial-other-hotspot-list" aria-label="其他热门标签">
            ${otherHotspots.map((hotspot) => `
              <li class="editorial-other-hotspot-chip">
                <a
                  href="${escapeHtml(safeUrl(hotspot.postUrl))}"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-editorial-other-hotspot="${escapeHtml(hotspot.label)}"
                  data-editorial-hotspot-topic="${escapeHtml(hotspot.topicId)}"
                  aria-label="打开${escapeHtml(hotspot.label)}对应的${escapeHtml(hotspot.topicTitle)}小红书原帖"
                >
                  <span class="editorial-hotspot-hash" aria-hidden="true">#</span>
                  <span>${escapeHtml(hotspot.label)}</span>
                  <i aria-hidden="true">↗</i>
                </a>
              </li>`).join("")}
          </ul>
        </section>`
      : "";

    container.innerHTML = `
      <div class="editorial-watch-grid">
        <div class="editorial-topic-stage">
          <div class="editorial-ranking-note">
            <span>${escapeHtml(windowLabel)}</span>
            <p>3 条已核实选题，先看怎么用；完整来源背景按需展开。</p>
          </div>
          ${topicMarkup}
          ${otherHotspotMarkup}
        </div>
        <aside class="editorial-source-panel" aria-label="选题来源账号">
          <span class="editorial-mini-label">选题来源</span>
          <p>辅助回看入口</p>
          <div class="editorial-source-links">
            ${sources.map((source) => `
              <a
                href="${safeUrl(source.profile_url)}"
                target="_blank"
                rel="noopener noreferrer"
                data-editorial-source="${escapeHtml(source.source_id)}"
                aria-label="打开${escapeHtml(source.account_name)}的小红书主页"
              >
                <span>${escapeHtml(source.account_name)}</span>
                <i aria-hidden="true">↗</i>
              </a>`).join("")}
          </div>
        </aside>
      </div>`;
  }

  function eventCard(event) {
    if (event.signal_kind === "post") {
      const sourceLabel = sourceClassLabels.get(event.source_class) || event.source_class;
      const subtypeLabel = {
        brand_keyword: "品牌关键词",
        drink_review_info: "测评／资讯号",
        food_creator: "美食号",
      }[event.source_subtype] || event.source_subtype;
      const metrics = event.engagement_snapshot || {};
      return `
        <article class="event-card source-signal-card" data-signal-id="${escapeHtml(event.signal_id)}">
          <div class="event-card-head">
            <span class="event-brand">${escapeHtml(event.primary_brand_name || event.source_name)}</span>
            <time class="event-date" datetime="${escapeHtml(event.published_at)}">${shortDate(event.published_at)} 发布</time>
          </div>
          <h3>${escapeHtml(event.title)}</h3>
          <div class="event-action-line">
            <span class="tag source-class-tag source-${escapeHtml(event.source_class)}">${escapeHtml(sourceLabel)}</span>
            <span class="tag secondary">${escapeHtml(subtypeLabel)}</span>
            ${renderThemeTags(event)}
          </div>
          <p class="source-signal-summary">${escapeHtml(event.summary || "已完成单帖回读。")}</p>
          <div class="event-entities">
            ${(event.topic_tags || []).length
              ? event.topic_tags.slice(0, 5).map((tag) => `<span class="entity-token">${escapeHtml(tag)}</span>`).join("")
              : `<span class="entity-token">暂无补充标签</span>`}
          </div>
          <div class="event-card-foot">
            <span class="event-evidence-count source-metrics">
              <strong>${formatNumber(metrics.likes)}</strong>
              <span>点赞 · ${formatNumber(metrics.collects)} 收藏 · ${formatNumber(metrics.comments)} 评论</span>
            </span>
            <a class="event-open" href="${escapeHtml(safeUrl(event.direct_post_url))}" target="_blank" rel="noopener noreferrer" aria-label="打开小红书原帖：${escapeHtml(event.title)}">打开单条原帖 ↗</a>
          </div>
          <p class="source-signal-origin">来自 ${escapeHtml(event.source_name)} · ${escapeHtml(event.published_at_visible || "时间已回读")}</p>
        </article>`;
    }
    const entities = bestEventEntityRows(event).slice(0, 6);
    const reviewTag = event.tag_review_status === "needs_human_review"
      ? `<span class="tag review">待复核</span>`
      : "";
    return `
      <article class="event-card" data-event-id="${escapeHtml(event.event_id)}">
        <div class="event-card-head">
          <span class="event-brand">${escapeHtml(event.primary_brand_name)}</span>
          <time class="event-date" datetime="${escapeHtml(event.latest_at)}">${shortDate(event.latest_at)} 更新</time>
        </div>
        <h3>${escapeHtml(event.standard_name)}</h3>
        <div class="event-action-line">
          ${renderThemeTags(event)}
          ${renderOriginalActionTag(event)}
          <span class="tag secondary">${escapeHtml(event.action.level2_label)}</span>
          ${reviewTag}
        </div>
        <div class="event-entities">
          ${entities.length
            ? entities.map((item) => `<span class="entity-token">${escapeHtml(item.entity.canonical_name)}</span>`).join("")
            : `<span class="entity-token">暂无核心实体</span>`}
        </div>
        <div class="event-card-foot">
          <span class="event-evidence-count">
            <strong>${event.evidence_count}</strong>
            <span>条官方证据</span>
          </span>
          <button class="event-open" type="button" data-open-event="${escapeHtml(event.event_id)}">查看事件与证据 ↗</button>
        </div>
      </article>`;
  }

  function renderActiveChips() {
    const labelMaps = new Map();
    filterConfig.forEach((group) => {
      if (group.options) group.options.forEach((option) => labelMaps.set(`${group.dimension}:${option.value}`, option.label));
    });
    const chips = [];
    Object.entries(state).forEach(([dimension, value]) => {
      if (dimension === "entityQuery") {
        if (value.trim()) chips.push({ dimension, value, label: `实体：${value.trim()}` });
        return;
      }
      if (dimension === "coreTheme") {
        value.forEach((item) => chips.push({
          dimension,
          value: item,
          label: `主线：${themeMap.get(item)?.label || item}`,
        }));
        return;
      }
      if (dimension === "coreTag") {
        value.forEach((item) => chips.push({
          dimension,
          value: item,
          label: `标签：${coreTagMap.get(item)?.label || item}`,
        }));
        return;
      }
      value.forEach((item) => chips.push({
        dimension,
        value: item,
        label: labelMaps.get(`${dimension}:${item}`) || item,
      }));
    });
    $("#active-filter-chips").innerHTML = chips.map((chip) => `
      <button class="active-chip" type="button" data-remove-dimension="${escapeHtml(chip.dimension)}" data-remove-value="${escapeHtml(chip.value)}">
        ${escapeHtml(chip.label)} <i aria-hidden="true">×</i>
      </button>`).join("");
  }

  function renderEvents() {
    $("#event-result-count").textContent = `${visibleEvents.length} 条市场线索`;
    const count = activeFilterCount();
    $("#filter-summary").textContent = count ? `已使用 ${count} 个筛选条件` : "当前为全部结果";
    $("#mobile-filter-count").textContent = String(count);
    const shown = visibleEvents.slice(0, eventVisibleLimit);
    $("#event-list").innerHTML = shown.map(eventCard).join("");
    $("#event-list").hidden = visibleEvents.length === 0;
    $("#event-empty").hidden = visibleEvents.length !== 0;
    $("#event-load-more").hidden = shown.length >= visibleEvents.length;
    $("#event-load-more").textContent = `查看更多市场线索（剩余 ${Math.max(visibleEvents.length - shown.length, 0)} 条）`;
    renderActiveChips();
  }

  function filteredContents() {
    const visibleEventIds = new Set(visibleEvents.map((event) => event.event_id).filter(Boolean));
    const filtersActive = activeFilterCount() > 0;
    const query = $("#content-search").value.trim().toLocaleLowerCase("zh-CN");
    const sort = $("#content-sort").value;
    const rows = DATA.contents.filter((content) => {
      const linkedEventIds = content.event_ids?.length ? content.event_ids : [content.primary_event_id];
      if (filtersActive && !linkedEventIds.some((eventId) => visibleEventIds.has(eventId))) return false;
      if (!matchesSet(themeIds(content), state.coreTheme)) return false;
      if (!matchesSet(content.tag_ids || [], state.coreTag)) return false;
      if (!query) return true;
      const event = eventMap.get(content.primary_event_id);
      const contentEntities = (relationsByContent.get(content.content_id) || [])
        .map((relation) => entityMap.get(relation.entity_id)?.canonical_name)
        .filter(Boolean)
        .join(" ");
      return [
        content.brand_name,
        content.title,
        content.body,
        event?.standard_name,
        contentEntities,
      ].join(" ").toLocaleLowerCase("zh-CN").includes(query);
    });
    rows.sort((a, b) => {
      if (sort === "likes") return (b.engagement_snapshot.likes || 0) - (a.engagement_snapshot.likes || 0);
      if (sort === "collects") return (b.engagement_snapshot.collects || 0) - (a.engagement_snapshot.collects || 0);
      if (sort === "comments") return (b.engagement_snapshot.comments || 0) - (a.engagement_snapshot.comments || 0);
      return b.published_at.localeCompare(a.published_at) || a.content_id.localeCompare(b.content_id);
    });
    return rows;
  }

  function contentRow(content) {
    const event = eventMap.get(content.primary_event_id);
    const snapshot = content.engagement_snapshot;
    return `
      <article class="content-row">
        <span class="content-brand">${escapeHtml(content.brand_name)}</span>
        <div class="content-main">
          <h3>${escapeHtml(content.title)}</h3>
          <p>${escapeHtml(content.content_stage)} · ${escapeHtml(content.content_role)}</p>
        </div>
        <span class="content-event">${escapeHtml(event?.standard_name || "事件待关联")}</span>
        <time class="content-date" datetime="${escapeHtml(content.published_at)}">${shortDate(content.published_at)}</time>
        <div class="engagement" aria-label="互动快照">
          <span><strong>${formatNumber(snapshot.likes)}</strong>点赞</span>
          <span><strong>${formatNumber(snapshot.collects)}</strong>收藏</span>
          <span><strong>${formatNumber(snapshot.comments)}</strong>评论</span>
        </div>
        <a class="source-link" href="${escapeHtml(safeUrl(content.url))}" target="_blank" rel="noopener noreferrer" aria-label="打开小红书原文：${escapeHtml(content.title)}">查看单条原文 ↗</a>
      </article>`;
  }

  function renderContents() {
    const rows = filteredContents();
    const shown = rows.slice(0, contentVisibleLimit);
    const followsFilters = activeFilterCount() > 0 ? "，跟随当前线索筛选" : "";
    const nonBrandOnly = state.sourceClass.size > 0 && !state.sourceClass.has("brand");
    $("#content-result-count").textContent = `${rows.length} 条官号内容${followsFilters}`;
    $("#content-list").innerHTML = shown.length
      ? shown.map(contentRow).join("")
      : nonBrandOnly
        ? `<div class="empty-state"><h3>三方与 KOC 以单帖线索呈现</h3><p>请在上方线索卡片中直接打开对应小红书原帖；这里仍只保留 94 条品牌官号证据。</p></div>`
        : `<div class="empty-state"><h3>没有符合条件的原始内容</h3><p>请调整搜索词或线索筛选。</p></div>`;
    $("#content-load-more").hidden = shown.length >= rows.length;
    $("#content-load-more").textContent = `继续查看（剩余 ${Math.max(rows.length - shown.length, 0)} 条）`;
  }

  function refreshResults() {
    filterEvents();
    renderEvents();
    renderContents();
  }

  function eventDialogMarkup(event) {
    const metric = biEventMetricMap.get(event.event_id) || {};
    const entityRows = bestEventEntityRows(event, true);
    const grouped = new Map();
    for (const row of entityRows) {
      const type = row.entity.entity_type;
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type).push(row);
    }
    const evidence = event.content_ids
      .map((id) => contentMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.published_at.localeCompare(b.published_at));
    const categories = unique(event.product_categories.map((item) => item.level2_label));
    return `
      <p class="dialog-eyebrow">${escapeHtml(event.primary_brand_name)} · 品牌官号证据</p>
      <h2 id="dialog-title">${escapeHtml(event.standard_name)}</h2>
      <p class="dialog-summary">${escapeHtml(event.summary)}</p>
      <div class="event-action-line">
        ${renderThemeTags(event)}
        ${renderOriginalActionTag(event)}
        <span class="tag secondary">${escapeHtml(event.action.level2_label)}</span>
        ${event.tag_review_status === "needs_human_review" ? `<span class="tag review">待复核</span>` : ""}
      </div>
      <div class="dialog-facts">
        <div><span>时间范围</span><strong>${shortDate(event.started_at)}—${shortDate(event.latest_at)}</strong></div>
        <div><span>官号证据</span><strong>${event.evidence_count} 条</strong></div>
        <div><span>产品品类</span><strong>${escapeHtml(categories.join("、") || "非产品")}</strong></div>
        <div><span>判断状态</span><strong>${escapeHtml(signalLabels[event.trend_claim] || event.trend_claim)}</strong></div>
      </div>
      <details class="dialog-data-details">
        <summary>查看互动数据与口径</summary>
        <div class="dialog-facts dialog-metric-facts">
          <div><span>有互动数据的帖子</span><strong>${formatNumber(metric.likes_valid_count)}</strong></div>
          <div><span>点赞中位数</span><strong>${formatNumber(metric.likes_median)}</strong></div>
          <div><span>高表现参考线</span><strong>${formatNumber(metric.likes_p75)}</strong></div>
          <div><span>最高单条</span><strong>${formatNumber(metric.likes_max)}</strong></div>
        </div>
        <p class="dialog-metric-note">互动快照龄 ${formatNumber(metric.snapshot_age_hours_min)}—${formatNumber(metric.snapshot_age_hours_max)} 小时；样本少于 5 条时只作案例观察。</p>
      </details>
      <section class="dialog-section">
        <h3>关联业务模块</h3>
        <div class="event-action-line">${event.business_modules.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>
      </section>
      <section class="dialog-section">
        <h3>动态实体及其角色</h3>
        <div class="dialog-entity-groups">
          ${grouped.size ? [...grouped.entries()].map(([type, rows]) => `
            <div class="dialog-entity-group">
              <strong>${escapeHtml(entityTypeLabels[type] || type)}</strong>
              <p>${rows.map((row) => `${escapeHtml(row.entity.canonical_name)}（${escapeHtml(roleLabels[row.role] || row.role)}）`).join("、")}</p>
            </div>`).join("") : `<p>暂无已确认实体。</p>`}
        </div>
      </section>
      <section class="dialog-section">
        <h3>传播阶段与原始证据</h3>
        <div class="evidence-stack">
          ${evidence.map((content) => `
            <article class="dialog-evidence">
              <time datetime="${escapeHtml(content.published_at)}">${shortDate(content.published_at)} · ${escapeHtml(content.content_stage)}</time>
              <div>
                <h4>${escapeHtml(content.title)}</h4>
                <p>点赞 ${formatNumber(content.engagement_snapshot.likes)} · 收藏 ${formatNumber(content.engagement_snapshot.collects)} · 评论 ${formatNumber(content.engagement_snapshot.comments)}</p>
              </div>
              <a href="${escapeHtml(safeUrl(content.url))}" target="_blank" rel="noopener noreferrer" aria-label="打开原文：${escapeHtml(content.title)}">查看单条小红书原文 ↗</a>
            </article>`).join("")}
        </div>
      </section>`;
  }

  function openEventDialog(eventId, trigger) {
    const event = eventMap.get(eventId);
    if (!event) return;
    lastEventTrigger = trigger || null;
    $("#event-dialog-content").innerHTML = eventDialogMarkup(event);
    const dialog = $("#event-dialog");
    dialog.showModal();
    document.body.classList.add("dialog-open");
    $("#event-dialog-close").focus();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function setupDialogs() {
    const eventDialog = $("#event-dialog");
    $("#event-dialog-close").addEventListener("click", () => closeDialog(eventDialog));
    eventDialog.addEventListener("click", (event) => {
      if (event.target === eventDialog) closeDialog(eventDialog);
    });
    eventDialog.addEventListener("close", () => {
      if (!$$("dialog[open]").length) document.body.classList.remove("dialog-open");
      if (lastEventTrigger && document.contains(lastEventTrigger)) lastEventTrigger.focus();
      lastEventTrigger = null;
    });

    const mobileDialog = $("#mobile-filter-dialog");
    $("#mobile-filter-open").addEventListener("click", () => {
      mobileDialog.showModal();
      document.body.classList.add("dialog-open");
      $("#mobile-filter-close").focus();
    });
    $("#mobile-filter-close").addEventListener("click", () => closeDialog(mobileDialog));
    $("#mobile-filter-apply").addEventListener("click", () => closeDialog(mobileDialog));
    mobileDialog.addEventListener("click", (event) => {
      if (event.target === mobileDialog) closeDialog(mobileDialog);
    });
    mobileDialog.addEventListener("close", () => {
      if (!$$("dialog[open]").length) document.body.classList.remove("dialog-open");
      $("#mobile-filter-open").focus();
    });
  }

  function setupEvents() {
    document.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open-event]");
      if (openButton) {
        openEventDialog(openButton.dataset.openEvent, openButton);
        return;
      }
      const chip = event.target.closest("[data-remove-dimension]");
      if (chip) {
        const dimension = chip.dataset.removeDimension;
        if (dimension === "entityQuery") state.entityQuery = "";
        else if (dimension === "coreTheme") {
          state.coreTheme.delete(chip.dataset.removeValue);
          for (const tagId of [...state.coreTag]) {
            const tagThemes = coreTagMap.get(tagId)?.theme_ids || [];
            if (!tagThemes.some((themeId) => state.coreTheme.has(themeId))) state.coreTag.delete(tagId);
          }
        } else state[dimension].delete(chip.dataset.removeValue);
        syncFilterControls();
        refreshResults();
        return;
      }
      const sourceButton = event.target.closest("[data-apply-source]");
      if (sourceButton) {
        applySource(sourceButton.dataset.applySource);
        return;
      }
      const tagButton = event.target.closest("[data-apply-core-tag]");
      if (tagButton) {
        applyTheme(tagButton.dataset.themeId, tagButton.dataset.applyCoreTag);
        return;
      }
      const themeButton = event.target.closest("[data-apply-theme]");
      if (themeButton) {
        applyTheme(themeButton.dataset.applyTheme);
      }
    });
    $$(".reset-filters").forEach((button) => button.addEventListener("click", resetFilters));
    $("#content-search").addEventListener("input", () => {
      contentVisibleLimit = 12;
      renderContents();
    });
    $("#content-sort").addEventListener("change", () => {
      contentVisibleLimit = 12;
      renderContents();
    });
    $("#content-load-more").addEventListener("click", () => {
      contentVisibleLimit += 12;
      renderContents();
    });
    $("#event-load-more").addEventListener("click", () => {
      eventVisibleLimit += 12;
      renderEvents();
    });
  }

  function renderSourceCoverage() {
    const container = $("#source-coverage");
    if (!container) return;
    const sources = discovery.selected_koc_sources || [];
    const completed = sources.filter((source) => source.collection_status === "completed");
    const pending = sources.filter((source) => source.collection_status !== "completed");
    container.innerHTML = `
      <details>
        <summary>
          <span><strong>KOC 监测账号</strong> · ${completed.length}/${sources.length} 个已完成本轮</span>
          <small>${discovery.summary?.koc_post_count || 0} 条可回看原帖，${pending.length ? `${pending.length} 个账号待补抓` : "本轮已完成"}</small>
        </summary>
        <div class="source-coverage-list">
          ${sources.map((source) => `
            <a href="${escapeHtml(safeUrl(source.profile_url))}" target="_blank" rel="noopener noreferrer">
              <span>${escapeHtml(source.account_name)}</span>
              <em>${source.collection_status === "completed" ? `${source.retained_post_count} 条已抓` : "待补抓"}</em>
            </a>`).join("")}
        </div>
      </details>`;
  }

  function init() {
    renderMetaAndStatus();
    renderBiOverview();
    renderCoreThemes();
    renderTagMetrics();
    renderBreakdowns();
    renderPromotions();
    renderEditorialWatch();
    renderSourceCoverage();
    renderFilterControls($("#desktop-filters"), "desktop");
    renderFilterControls($("#mobile-filters"), "mobile");
    bindFilterControls($("#desktop-filters"));
    bindFilterControls($("#mobile-filters"));
    setupDialogs();
    setupEvents();
    syncFilterControls();
    refreshResults();
    $("#generated-time").textContent = fullDate(DATA.meta.generated_at);
  }

  init();
})();
