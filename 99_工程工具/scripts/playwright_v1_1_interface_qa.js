async (page) => {
  const baseUrl = "http://127.0.0.1:8765/";
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (message.type() === "warning") consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const checks = [];
  const check = (name, passed, detail = "") => {
    checks.push({ name, passed: Boolean(passed), detail });
  };
  const text = async (selector) => (await page.locator(selector).textContent() || "").trim();

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForSelector(".theme-analysis-card");

  check("区块标题为核心看点", (await text("#core-theme-heading")) === "核心看点");
  check(
    "页头使用初版黑底白杯橙色信号Logo",
    await page.locator(".brand-mark .beverage-cup-mark").count() === 1
      && await page.locator(".brand-mark .beverage-cup-mark svg path").count() === 2
      && await page.locator(".brand-mark .beverage-cup-mark").evaluate((mark) => {
        const style = getComputedStyle(mark);
        const fills = [...mark.querySelectorAll("path")].map((path) => path.getAttribute("fill"));
        return style.backgroundColor === "rgb(17, 17, 17)"
          && JSON.stringify(fills) === JSON.stringify(["#fff", "#f15b35"]);
      })
  );
  check(
    "品牌Logo可点击返回本周概览且具备准确名称",
    await page.locator(".brand-mark").getAttribute("href") === "#overview"
      && await page.locator(".brand-mark").getAttribute("aria-label") === "返回饮品热点雷达本周概览"
  );
  check(
    "浏览器图标与页头使用同一杯形识别",
    await page.locator("link[rel='icon']").evaluate((link) => {
      const href = link.getAttribute("href") || "";
      return href.includes("%23111111") && href.includes("%23f15b35") && href.includes("M18 19h28");
    })
  );
  check(
    "基础配色与初版品牌识别一致",
    await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const actual = ["--paper", "--surface", "--ink", "--ink-soft", "--leaf", "--orange"]
        .map((name) => style.getPropertyValue(name).trim());
      return JSON.stringify(actual) === JSON.stringify([
        "#f5f5f3", "#ffffff", "#11110f", "#666663", "#1f5c45", "#f15b35",
      ]);
    })
  );
  check(
    "小字色、主题选中态与焦点色对比度合格",
    await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const hexToRgb = (hex) => {
        const value = hex.replace("#", "");
        return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
      };
      const luminance = (hex) => hexToRgb(hex)
        .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = (a, b) => {
        const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };
      const paper = root.getPropertyValue("--paper").trim();
      const surface = root.getPropertyValue("--surface").trim();
      const orangeInk = root.getPropertyValue("--orange-ink").trim();
      const focus = root.getPropertyValue("--focus").trim();
      const themeAccents = [...document.querySelectorAll(".theme-analysis-card")]
        .map((card) => getComputedStyle(card).getPropertyValue("--theme-accent").trim());
      return Math.min(contrast(orangeInk, paper), contrast(orangeInk, surface)) >= 4.5
        && Math.min(contrast(focus, paper), contrast(focus, surface)) >= 3
        && themeAccents.every((accent) => contrast(accent, surface) >= 4.5 && contrast(accent, "#ffffff") >= 4.5);
    })
  );
  check(
    "正式标题为产品动作、联名合作、品牌事件",
    JSON.stringify(await page.locator(".theme-card-title").allTextContents())
      === JSON.stringify(["产品动作", "联名合作", "品牌事件"])
  );
  check(
    "好喝、好看、好玩仅作为装饰水印",
    JSON.stringify(await page.locator(".theme-watermark").allTextContents())
      === JSON.stringify(["好喝", "好看", "好玩"])
      && await page.locator(".theme-watermark[aria-hidden='true']").count() === 3
  );
  check(
    "装饰别名为粗体无衬线",
    await page.locator(".theme-watermark").evaluateAll((nodes) =>
      nodes.every((node) => {
        const style = getComputedStyle(node);
        return Number(style.fontWeight) >= 700
          && !/serif/i.test(style.fontFamily.replace(/sans-serif/ig, ""));
      })
    )
  );
  check("三张卡共24个精选标签", await page.locator("[data-apply-core-tag]").count() === 24);
  check("每张核心卡恰好1个代表事件入口", await page.locator(".theme-featured-event").count() === 3);
  check(
    "每张卡恰好8个精选标签",
    await page.locator(".theme-analysis-card").evaluateAll((cards) =>
      cards.every((card) => card.querySelectorAll("[data-apply-core-tag]").length === 8)
    )
  );
  check(
    "标签按事件数降序且同数按均赞降序",
    await page.evaluate(() => {
      const analyses = window.RADAR_V1_DATA?.summary?.theme_analyses || [];
      return analyses.every((analysis) => {
        const expected = [...analysis.tags].sort((a, b) =>
          Number(b.event_count || 0) - Number(a.event_count || 0)
          || Number(b.avg_likes ?? -1) - Number(a.avg_likes ?? -1)
          || String(a.label || "").localeCompare(String(b.label || ""), "zh-CN")
        ).map((tag) => tag.tag_id);
        const actual = [...document.querySelectorAll(
          `[data-theme-card="${analysis.theme_id}"] [data-apply-core-tag]`
        )].map((button) => button.dataset.applyCoreTag);
        return JSON.stringify(actual) === JSON.stringify(expected);
      });
    })
  );
  check(
    "全部精选标签同时显示事件数和单条均赞",
    await page.locator("[data-apply-core-tag]").evaluateAll((nodes) =>
      nodes.every((node) => /\d+个事件/.test(node.textContent || "") && /单条均赞\s[\d,—]+/.test(node.textContent || ""))
    )
  );
  check("新品上市均赞显示1,812", (await text("[data-apply-core-tag='product-new-launch'] small")) === "单条均赞 1,812");
  check(
    "首屏代表信号、KPI与来源数量模块已移除",
    await page.locator(".hero-signals, #kpi-grid, .source-pool-metrics").count() === 0
  );
  check("新增栏标题为近7天热点选题", (await text("#editorial-watch-heading")) === "近 7 天热点选题");
  check(
    "热点选题按点赞规则动态呈现",
    await page.evaluate(() => {
      const reference = window.RADAR_V1_DATA?.editorial_reference || {};
      const topics = reference.topics || [];
      const rows = [...document.querySelectorAll(".editorial-rank-item")];
      if (!topics.length) {
        return rows.length === 0
          && document.querySelector(".editorial-empty-state strong")?.textContent?.trim()
            === "近 7 天热点帖子待抓取复核";
      }
      const sorted = [...topics].sort((a, b) =>
        Number(b.likes ?? -1) - Number(a.likes ?? -1)
        || String(b.published_at || "").localeCompare(String(a.published_at || ""))
        || String(a.topic_id || "").localeCompare(String(b.topic_id || ""))
      );
      return rows.length === Math.min(sorted.length, Number(reference.ranking?.display_limit || 6))
        && rows.every((row, index) => {
          const topic = sorted[index];
          const link = row.querySelector("[data-editorial-topic-source]");
          const tags = [...row.querySelectorAll(".editorial-topic-tags span")]
            .map((tag) => tag.textContent?.trim());
          return link?.dataset.editorialTopicSource === topic.topic_id
            && row.textContent?.includes(topic.title)
            && row.textContent?.includes("🔥")
            && JSON.stringify(tags) === JSON.stringify((topic.topic_tags || []).slice(0, 5));
        });
    })
  );
  check(
    "已展示选题均直达同帖子ID的已验证小红书原帖",
    await page.locator("[data-editorial-topic-source]").evaluateAll((links) => {
      const reference = window.RADAR_V1_DATA?.editorial_reference || {};
      const topics = reference.topics || [];
      return links.every((link) => {
        const topic = topics.find((item) => item.topic_id === link.dataset.editorialTopicSource);
        const url = new URL(link.href);
        return topic
          && link.href === topic.direct_post_url
          && url.protocol === "https:"
          && url.hostname === "www.xiaohongshu.com"
          && url.pathname === `/explore/${topic.platform_post_id}`
          && Boolean(url.searchParams.get("xsec_token"))
          && url.searchParams.get("xsec_source") === "pc_search"
          && Number.isFinite(Date.parse(topic.direct_url_verified_at || ""))
          && link.target === "_blank"
          && link.rel.split(/\s+/).includes("noopener")
          && link.rel.split(/\s+/).includes("noreferrer");
      });
    })
  );
  check(
    "其他热点按关联帖点赞顺序展示并直达对应单篇笔记",
    await page.locator("[data-editorial-other-hotspot]").evaluateAll((links) => {
      const reference = window.RADAR_V1_DATA?.editorial_reference || {};
      const sorted = [...(reference.topics || [])].sort((a, b) =>
        Number(b.likes ?? -1) - Number(a.likes ?? -1)
        || String(b.published_at || "").localeCompare(String(a.published_at || ""))
        || String(a.topic_id || "").localeCompare(String(b.topic_id || ""))
      );
      const expected = [...new Map(sorted.flatMap((topic) =>
        (topic.hotspot_tags || []).map((label) => [label, {
          label,
          topicId: topic.topic_id,
          url: topic.direct_post_url,
        }]))).values()].slice(0, 10);
      const actual = links.map((link) => ({
        label: link.dataset.editorialOtherHotspot,
        topicId: link.dataset.editorialHotspotTopic,
        url: link.href,
      }));
      return JSON.stringify(actual) === JSON.stringify(expected)
        && links.every((link) => link.matches("a")
          && link.target === "_blank"
          && link.rel.split(/\s+/).includes("noopener")
          && link.rel.split(/\s+/).includes("noreferrer"));
    })
      && (await text(".editorial-other-hotspots h3")) === "其他热点"
      && (await text(".editorial-other-hotspots p")).includes("不等同于平台全站热榜")
  );
  check(
    "3个热点来源均为安全可点击主页",
    await page.locator("[data-editorial-source]").count() === 3
      && await page.locator("[data-editorial-source]").evaluateAll((links) => links.every((link) =>
        /^https:\/\/www\.xiaohongshu\.com\/user\/profile\/[0-9a-f]{24}$/.test(link.href)
        && link.target === "_blank"
        && link.rel.split(/\s+/).includes("noopener")
        && link.rel.split(/\s+/).includes("noreferrer")))
  );
  check(
    "热点来源入口不改变行业事件筛选",
    await page.locator("[data-editorial-source]").first().evaluate((link) => {
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      link.click();
      return document.querySelector("#event-result-count")?.textContent?.trim() === "64 条来源线索"
        && document.querySelectorAll("#active-filter-chips .active-chip").length === 0;
    })
  );
  check(
    "其他热点原帖入口不改变行业事件筛选",
    await page.locator("[data-editorial-other-hotspot]").first().evaluate((link) => {
      link.addEventListener("click", (event) => event.preventDefault(), { once: true });
      link.click();
      return document.querySelector("#event-result-count")?.textContent?.trim() === "64 条来源线索"
        && document.querySelectorAll("#active-filter-chips .active-chip").length === 0;
    })
  );

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(80);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cardTops: [...document.querySelectorAll(".theme-analysis-card")].map((item) =>
        Math.round(item.getBoundingClientRect().top)
      ),
      columns: getComputedStyle(document.querySelector(".theme-analysis-grid")).gridTemplateColumns.split(" ").length,
      tagMinHeight: Math.min(...[...document.querySelectorAll("[data-apply-core-tag]")].map((item) =>
        item.getBoundingClientRect().height
      )),
      sourceLinkMinHeight: Math.min(...[...document.querySelectorAll("[data-editorial-source]")].map((item) =>
        item.getBoundingClientRect().height
      )),
      hotspotLinkMinHeight: Math.min(...[...document.querySelectorAll("[data-editorial-other-hotspot]")].map((item) =>
        item.getBoundingClientRect().height
      )),
      headerBrandOverlap: (() => {
        const brand = document.querySelector(".brand-mark")?.getBoundingClientRect();
        const release = document.querySelector(".release-stamp")?.getBoundingClientRect();
        if (!brand || !release) return true;
        return brand.left < release.right
          && brand.right > release.left
          && brand.top < release.bottom
          && brand.bottom > release.top;
      })(),
      logoClipped: (() => {
        const logo = document.querySelector(".beverage-cup-mark")?.getBoundingClientRect();
        const header = document.querySelector(".header-bar")?.getBoundingClientRect();
        if (!logo || !header) return true;
        return logo.width < 30 || logo.height < 30
          || logo.left < header.left || logo.right > header.right
          || logo.top < header.top || logo.bottom > header.bottom;
      })(),
      watermarkOverlap: [...document.querySelectorAll(".theme-analysis-card")].some((card) => {
        const watermark = card.querySelector(".theme-watermark")?.getBoundingClientRect();
        if (!watermark) return true;
        return [".theme-card-title", ".theme-card-count", ".theme-card-heading > small"]
          .map((selector) => card.querySelector(selector)?.getBoundingClientRect())
          .filter(Boolean)
          .some((rect) =>
            watermark.left < rect.right
            && watermark.right > rect.left
            && watermark.top < rect.bottom
            && watermark.bottom > rect.top);
      }),
    }));
    check(
      `${width}px无横向溢出`,
      dimensions.scrollWidth <= dimensions.viewport,
      JSON.stringify(dimensions)
    );
    check(`${width}px品牌与版本标记不重叠`, !dimensions.headerBrandOverlap, JSON.stringify(dimensions));
    check(`${width}px杯形Logo完整可见`, !dimensions.logoClipped, JSON.stringify(dimensions));
    check(`${width}px装饰别名不与标题、数字或说明重叠`, !dimensions.watermarkOverlap, JSON.stringify(dimensions));
    if (width >= 1024) {
      check(`${width}px三张卡保持同一行`, new Set(dimensions.cardTops).size === 1 && dimensions.columns === 3, JSON.stringify(dimensions));
    }
    if (width <= 390) {
      check(`${width}px标签触控高度不小于52px`, dimensions.tagMinHeight >= 52, String(dimensions.tagMinHeight));
      check(`${width}px热点来源触控高度不小于44px`, dimensions.sourceLinkMinHeight >= 44, String(dimensions.sourceLinkMinHeight));
      check(`${width}px其他热点链接高度不小于32px`, dimensions.hotspotLinkMinHeight >= 32, String(dimensions.hotspotLinkMinHeight));
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator(".brand-mark").focus();
  check(
    "品牌Logo键盘焦点清晰可见",
    await page.locator(".brand-mark").evaluate((link) => {
      const style = getComputedStyle(link);
      return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3;
    })
  );
  await page.locator("[data-editorial-source]").first().focus();
  check(
    "热点来源链接键盘焦点清晰可见",
    await page.locator("[data-editorial-source]").first().evaluate((link) => {
      const style = getComputedStyle(link);
      return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3;
    })
  );
  if (await page.locator("[data-editorial-topic-source]").count()) {
    await page.locator("[data-editorial-topic-source]").first().focus();
    check(
      "热点选题原帖链接键盘焦点清晰可见",
      await page.locator("[data-editorial-topic-source]").first().evaluate((link) => {
        const style = getComputedStyle(link);
        return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3;
      })
    );
  }
  if (await page.locator("[data-editorial-other-hotspot]").count()) {
    await page.locator("[data-editorial-other-hotspot]").first().focus();
    check(
      "其他热点原帖链接键盘焦点清晰可见",
      await page.locator("[data-editorial-other-hotspot]").first().evaluate((link) => {
        const style = getComputedStyle(link);
        return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 3;
      })
    );
  }

  await page.goto(baseUrl, { waitUntil: "load" });
  check("默认展示64条品牌、三方与KOC线索", (await text("#event-result-count")) === "64 条来源线索");
  check(
    "来源筛选替代标签复核并显示35品牌10三方19KOC",
    await page.locator("[data-filter-dimension='sourceClass']").count() === 6
      && await page.locator("[data-filter-dimension='review']").count() === 0
      && (await text("#desktop-filters [data-filter-dimension='sourceClass'][value='brand'] + span")) === "品牌"
      && (await text("#desktop-filters [data-filter-dimension='sourceClass'][value='brand'] ~ small")) === "35"
      && (await text("#desktop-filters [data-filter-dimension='sourceClass'][value='third_party'] ~ small")) === "10"
      && (await text("#desktop-filters [data-filter-dimension='sourceClass'][value='koc'] ~ small")) === "19"
  );
  check("8个指定KOC账号均在覆盖清单", await page.locator(".source-coverage-list a").count() === 8);

  await page.locator("#desktop-filters input[data-filter-dimension='sourceClass'][value='third_party']").check();
  check("三方筛选得到10条单帖线索", (await text("#event-result-count")) === "10 条来源线索");
  check("三方卡片均直达单条原帖", await page.locator(".source-signal-card .event-open").count() === 10
    && await page.locator(".source-signal-card .event-open").evaluateAll((links) => links.every((link) => {
      const url = new URL(link.href);
      return /^\/explore\/[0-9a-f]{24}$/.test(url.pathname)
        && Boolean(url.searchParams.get("xsec_token"))
        && link.target === "_blank";
    })));

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("#desktop-filters input[data-filter-dimension='sourceClass'][value='koc']").check();
  check("KOC筛选得到19条已验证原帖", (await text("#event-result-count")) === "19 条来源线索");
  check("KOC只展示已回读原帖并提示全部完成", await page.locator(".source-signal-card").count() === 19
    && (await text("#source-coverage")).includes("全部账号已完成本轮"));

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator(".theme-featured-event").first().click();
  check("代表事件入口打开事件详情", await page.locator("#event-dialog").evaluate((dialog) => dialog.open));
  await page.locator("#event-dialog-close").click();

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-theme='product_action']").click();
  check("产品动作筛选得到40条来源线索", (await text("#event-result-count")) === "40 条来源线索");
  check("产品动作同步77条原始内容", (await text("#content-result-count")).startsWith("77 条内容"));
  check("主题活动标签同步为1个", await page.locator("#active-filter-chips .active-chip").count() === 1);

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-core-tag='product-new-launch']").click();
  check("新品上市标签得到5个品牌事件", (await text("#event-result-count")) === "5 条来源线索");
  check("新品上市标签精确联动7条内容", (await text("#content-result-count")).startsWith("7 条内容"));
  check("标签点击同步主题与标签两个活动条件", await page.locator("#active-filter-chips .active-chip").count() === 2);

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-core-tag='product-pineapple']").click();
  check("菠萝标签得到2个品牌事件", (await text("#event-result-count")) === "2 条来源线索");
  check("菠萝标签精确联动25条内容", (await text("#content-result-count")).startsWith("25 条内容"));

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-core-tag='collaboration-duolingo']").click();
  check("多邻国标签得到1个事件和2条内容",
    (await text("#event-result-count")) === "1 条来源线索"
      && (await text("#content-result-count")).startsWith("2 条内容"));

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-core-tag='brand-corporate-legal']").click();
  check("企业法律公共事务标签得到1个事件和1条内容",
    (await text("#event-result-count")) === "1 条来源线索"
      && (await text("#content-result-count")).startsWith("1 条内容"));

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("#desktop-filters input[data-filter-dimension='coreTheme'][value='product_action']").check();
  await page.locator("#desktop-filters input[data-filter-dimension='coreTheme'][value='collaboration']").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  check("两个主题按OR合并为46条去重线索", (await text("#event-result-count")) === "46 条来源线索");
  check("两个主题按OR联动81条去重内容", (await text("#content-result-count")).startsWith("81 条内容"));
  check(
    "跨主题瑞幸Crocs事件仍只显示一次",
    await page.locator("[data-event-id='EVT-2026W30-LUCKIN-CROCS']").count() === 1
  );
  await page.locator("[data-remove-dimension='coreTheme'][data-remove-value='product_action']").click();
  check("移除产品动作后保留联名合作19条线索", (await text("#event-result-count")) === "19 条来源线索");
  check("移除产品动作后保留联名合作50条内容", (await text("#content-result-count")).startsWith("50 条内容"));

  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-theme='brand_event']").focus();
  await page.keyboard.press("Enter");
  check("主题按钮可用键盘Enter触发", (await text("#event-result-count")) === "34 条来源线索");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("#desktop-filters input[data-filter-dimension='coreTheme'][value='collaboration']").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  check(
    "手机筛选状态与桌面同步",
    await page.locator("#mobile-filters input[data-filter-dimension='coreTheme'][value='collaboration']").isChecked()
      && (await text("#mobile-filter-count")) === "1"
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.evaluate(() => {
    window.__qaScrollBehavior = "";
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(options) {
      window.__qaScrollBehavior = options?.behavior || "";
      return original.call(this, options);
    };
  });
  await page.locator("[data-apply-theme='product_action']").click();
  check("减少动态模式使用无动画滚动", await page.evaluate(() => window.__qaScrollBehavior) === "auto");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.locator("[data-apply-theme='product_action']").click();
  await page.locator("#mobile-filter-open").click();
  await page.locator("#mobile-filter-dialog .reset-filters").click();
  check("清空恢复64条来源线索", (await text("#event-result-count")) === "64 条来源线索");
  check("清空恢复94条内容", (await text("#content-result-count")).startsWith("94 条内容"));

  check("浏览器控制台0错误", consoleErrors.length === 0, JSON.stringify(consoleErrors));
  check("浏览器控制台0警告", consoleWarnings.length === 0, JSON.stringify(consoleWarnings));

  return {
    passed: checks.every((item) => item.passed),
    check_count: checks.length,
    passed_count: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed),
    console_errors: consoleErrors,
    console_warnings: consoleWarnings,
    checks,
  };
}
