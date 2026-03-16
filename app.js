const STORAGE_KEYS = {
    pins: "mytools:pinned-links",
    usage: "mytools:usage-counts",
};

const DEFAULT_COMMON_LIMIT = 12;

const state = {
    data: null,
    linkMap: new Map(),
    defaultCommonUrls: [],
    activeCategory: "全部",
    query: "",
    expandedSections: new Set(),
    pins: [],
    usage: {},
};

const elements = {
    commonGrid: document.getElementById("commonGrid"),
    categoryStack: document.getElementById("categoryStack"),
    searchResults: document.getElementById("searchResults"),
    resultBanner: document.getElementById("resultBanner"),
    filterStrip: document.getElementById("filterStrip"),
    emptyState: document.getElementById("emptyState"),
    searchInput: document.getElementById("searchInput"),
    linkCount: document.getElementById("linkCount"),
    categoryCount: document.getElementById("categoryCount"),
    commonCount: document.getElementById("commonCount"),
    clearPinsButton: document.getElementById("clearPinsButton"),
    clearUsageButton: document.getElementById("clearUsageButton"),
};

init();

async function init() {
    loadPreferences();
    bindEvents();

    try {
        const response = await fetch("./bookmarks_data.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        state.data = await response.json();
        buildLinkMap();
        sanitizePreferences();
        hydrateStats();
        renderFilters();
        render();
    } catch (error) {
        elements.emptyState.classList.remove("hidden");
        elements.emptyState.innerHTML = `
            <p class="state-kicker">Load failed</p>
            <h2>没能读取导航数据</h2>
            <p>请确认 <code>bookmarks_data.json</code> 和页面在同一目录，并通过本地服务器或 Vercel 访问页面。</p>
        `;
        console.error(error);
    }
}

function bindEvents() {
    elements.searchInput.addEventListener("input", (event) => {
        state.query = event.target.value.trim().toLowerCase();
        render();
    });

    elements.filterStrip.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-category]");
        if (!button) {
            return;
        }
        state.activeCategory = button.dataset.category;
        renderFilters();
        render();
    });

    elements.categoryStack.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-section-key]");
        if (!button) {
            return;
        }
        toggleSection(button.dataset.sectionKey);
    });

    elements.clearPinsButton.addEventListener("click", () => {
        state.pins = [];
        savePreferences(STORAGE_KEYS.pins, state.pins);
        hydrateStats();
        render();
    });

    elements.clearUsageButton.addEventListener("click", () => {
        state.usage = {};
        savePreferences(STORAGE_KEYS.usage, state.usage);
        render();
    });

    document.addEventListener("click", (event) => {
        const pinButton = event.target.closest("button[data-pin-url]");
        if (pinButton) {
            event.preventDefault();
            togglePin(pinButton.dataset.pinUrl);
            return;
        }

        const trackedLink = event.target.closest("a[data-track-url]");
        if (trackedLink) {
            recordUsage(trackedLink.dataset.trackUrl);
        }
    });
}

function loadPreferences() {
    state.pins = loadStoredValue(STORAGE_KEYS.pins, []);
    state.usage = loadStoredValue(STORAGE_KEYS.usage, {});
}

function loadStoredValue(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.warn(`Unable to read ${key}`, error);
        return fallback;
    }
}

function savePreferences(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Unable to save ${key}`, error);
    }
}

function buildLinkMap() {
    state.linkMap = new Map();
    state.defaultCommonUrls = state.data.common.map((link) => link.url);

    for (const category of state.data.categories) {
        for (const section of category.sections) {
            for (const link of section.links) {
                registerLink(link, category.name, section.name);
            }
        }
    }

    for (const link of state.data.common) {
        if (!state.linkMap.has(link.url)) {
            registerLink(link, "常用", "默认推荐");
        }
    }
}

function registerLink(link, category, section) {
    if (!state.linkMap.has(link.url)) {
        state.linkMap.set(link.url, {
            title: link.title,
            url: link.url,
            category,
            section,
        });
    }
}

function sanitizePreferences() {
    state.pins = state.pins.filter((url) => state.linkMap.has(url));
    const sanitizedUsage = {};
    for (const [url, count] of Object.entries(state.usage)) {
        if (state.linkMap.has(url) && Number.isFinite(count) && count > 0) {
            sanitizedUsage[url] = count;
        }
    }
    state.usage = sanitizedUsage;
    savePreferences(STORAGE_KEYS.pins, state.pins);
    savePreferences(STORAGE_KEYS.usage, state.usage);
}

function hydrateStats() {
    elements.linkCount.textContent = state.linkMap.size.toString();
    elements.categoryCount.textContent = state.data.categories.length.toString();
    elements.commonCount.textContent = state.pins.length.toString();
}

function renderFilters() {
    const categories = ["全部", ...state.data.categories.map((category) => category.name)];
    elements.filterStrip.innerHTML = categories.map((category) => {
        const active = state.activeCategory === category ? " active" : "";
        return `<button class="filter-chip${active}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`;
    }).join("");
}

function render() {
    if (!state.data) {
        return;
    }

    renderCommon();

    const activeCategories = state.data.categories.filter((category) => {
        return state.activeCategory === "全部" || category.name === state.activeCategory;
    });

    const query = state.query;
    const results = query ? collectSearchResults(activeCategories, query) : [];

    elements.emptyState.classList.add("hidden");

    if (query) {
        renderSearchResults(results, query);
        elements.categoryStack.classList.add("hidden");
    } else {
        elements.searchResults.classList.add("hidden");
        elements.resultBanner.classList.add("hidden");
        elements.categoryStack.classList.remove("hidden");
        renderCategories(activeCategories);
    }

    if (!query && activeCategories.length === 0) {
        elements.emptyState.classList.remove("hidden");
        elements.emptyState.innerHTML = `
            <p class="state-kicker">Empty</p>
            <h2>这个分类里还没有内容</h2>
            <p>你可以切回“全部”，或者继续更新 <code>bookmarks_data.json</code>。</p>
        `;
    }
}

function getRecommendedCommonLinks() {
    const recommended = [];
    const used = new Set();
    const limit = Math.max(DEFAULT_COMMON_LIMIT, state.pins.length);

    for (const url of state.pins) {
        const link = state.linkMap.get(url);
        if (link && !used.has(url)) {
            recommended.push({ ...link, reason: "pinned" });
            used.add(url);
        }
    }

    const byUsage = [...state.linkMap.values()]
        .filter((link) => !used.has(link.url) && (state.usage[link.url] || 0) > 0)
        .sort((left, right) => {
            const usageDiff = (state.usage[right.url] || 0) - (state.usage[left.url] || 0);
            if (usageDiff !== 0) {
                return usageDiff;
            }
            return left.title.localeCompare(right.title, "zh-CN");
        });

    for (const link of byUsage) {
        if (recommended.length >= limit) {
            break;
        }
        recommended.push({ ...link, reason: "recent" });
        used.add(link.url);
    }

    for (const url of state.defaultCommonUrls) {
        if (recommended.length >= limit || used.has(url)) {
            continue;
        }
        const link = state.linkMap.get(url);
        if (link) {
            recommended.push({ ...link, reason: "default" });
            used.add(link.url);
        }
    }

    const fallback = [...state.linkMap.values()].sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
    for (const link of fallback) {
        if (recommended.length >= limit) {
            break;
        }
        if (!used.has(link.url)) {
            recommended.push({ ...link, reason: "fallback" });
            used.add(link.url);
        }
    }

    return recommended;
}

function renderCommon() {
    const links = getRecommendedCommonLinks();
    elements.commonGrid.innerHTML = links.map((link) => renderBookmarkCard(link, {
        categoryName: link.category,
        sectionName: link.section,
        badge: recommendationLabel(link.reason),
        badgeType: link.reason,
    })).join("");
}

function renderCategories(categories) {
    elements.categoryStack.innerHTML = categories.map((category) => {
        const total = category.sections.reduce((sum, section) => sum + section.links.length, 0);
        const sections = category.sections.map((section) => renderSection(category.name, section)).join("");
        return `
            <article class="category-card">
                <div class="category-head">
                    <div>
                        <p class="panel-kicker">Category</p>
                        <h2>${escapeHtml(category.name)}</h2>
                        <p>按小分组展开，避免整页一次性塞满。</p>
                    </div>
                    <span class="category-pill">${total} 条</span>
                </div>
                ${sections}
            </article>
        `;
    }).join("");
}

function renderSection(categoryName, section) {
    const key = `${categoryName}::${section.name}`;
    const expanded = state.expandedSections.has(key) || section.links.length <= 12;
    const visibleLinks = expanded ? section.links : section.links.slice(0, 12);
    const remaining = section.links.length - visibleLinks.length;

    return `
        <section class="section-card">
            <div class="section-head">
                <div>
                    <h3>${escapeHtml(section.name)}</h3>
                    <span class="section-count">${section.links.length} 条链接</span>
                </div>
                ${section.links.length > 12 ? `
                    <button class="section-toggle" type="button" data-section-key="${escapeAttribute(key)}">
                        ${expanded ? "收起" : `展开剩余 ${remaining} 条`}
                    </button>
                ` : ""}
            </div>
            <div class="link-grid">
                ${visibleLinks.map((link) => renderBookmarkCard(link, { categoryName, sectionName: section.name })).join("")}
            </div>
        </section>
    `;
}

function renderBookmarkCard(link, { categoryName, sectionName, badge = "", badgeType = "" }) {
    const pinned = state.pins.includes(link.url);
    const badgeMarkup = badge ? `<span class="recommend-badge ${escapeAttribute(badgeType)}">${escapeHtml(badge)}</span>` : `<span></span>`;

    return `
        <article class="bookmark-card">
            <a class="bookmark-link" href="${escapeAttribute(link.url)}" data-track-url="${escapeAttribute(link.url)}" target="_blank" rel="noreferrer">
                <span class="bookmark-title">${escapeHtml(link.title)}</span>
                <span class="bookmark-meta">${escapeHtml(formatDomain(link.url))} · ${escapeHtml(categoryName)} / ${escapeHtml(sectionName)}</span>
            </a>
            <div class="bookmark-toolbar">
                ${badgeMarkup}
                <button class="pin-button${pinned ? " active" : ""}" type="button" data-pin-url="${escapeAttribute(link.url)}">
                    ${pinned ? "取消固定" : "固定"}
                </button>
            </div>
        </article>
    `;
}

function collectSearchResults(categories, query) {
    const matches = [];
    for (const category of categories) {
        for (const section of category.sections) {
            for (const link of section.links) {
                const haystack = `${link.title} ${link.url} ${category.name} ${section.name}`.toLowerCase();
                if (haystack.includes(query)) {
                    matches.push({
                        ...link,
                        category: category.name,
                        section: section.name,
                    });
                }
            }
        }
    }
    return matches;
}

function renderSearchResults(results, query) {
    elements.searchResults.classList.remove("hidden");
    elements.resultBanner.classList.remove("hidden");
    elements.categoryStack.classList.add("hidden");

    elements.resultBanner.innerHTML = `
        <div>
            <strong>搜索结果</strong>
            <div>${results.length} 条匹配 “${escapeHtml(query)}”</div>
        </div>
        <div>当前范围：${escapeHtml(state.activeCategory)}</div>
    `;

    if (!results.length) {
        elements.searchResults.innerHTML = `
            <div class="state-panel">
                <p class="state-kicker">No Match</p>
                <h2>没有找到相关收藏</h2>
                <p>试试更短的关键词，或者切回“全部”分类再搜。</p>
            </div>
        `;
        return;
    }

    elements.searchResults.innerHTML = `
        <div class="search-grid">
            ${results.map((result) => renderBookmarkCard(result, {
                categoryName: result.category,
                sectionName: result.section,
            })).join("")}
        </div>
    `;
}

function recommendationLabel(reason) {
    switch (reason) {
        case "pinned":
            return "已固定";
        case "recent":
            return "最近常点";
        case "default":
            return "默认推荐";
        default:
            return "补位推荐";
    }
}

function toggleSection(key) {
    if (state.expandedSections.has(key)) {
        state.expandedSections.delete(key);
    } else {
        state.expandedSections.add(key);
    }
    render();
}

function togglePin(url) {
    if (state.pins.includes(url)) {
        state.pins = state.pins.filter((item) => item !== url);
    } else {
        state.pins = [url, ...state.pins.filter((item) => item !== url)];
    }
    savePreferences(STORAGE_KEYS.pins, state.pins);
    hydrateStats();
    render();
}

function recordUsage(url) {
    state.usage[url] = (state.usage[url] || 0) + 1;
    savePreferences(STORAGE_KEYS.usage, state.usage);
    renderCommon();
}

function formatDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch (error) {
        return url;
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
    return escapeHtml(value);
}
