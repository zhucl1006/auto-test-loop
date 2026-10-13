/**
 * AiReach 全功能回归目录。
 *
 * 默认套件只做可重复的功能验证：打开页面、确认锚点、做不落库的交互。
 * 不发送活动、不删除客户、不调用 Gemini 生成。写操作仅在 REGRESSION_MUTATE=1 时由 API 套件执行。
 */

const WEB_URL = (process.env.WEB_URL || "http://127.0.0.1:5173").replace(/\/$/, "");

function requiredLocalEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " 未设置。请写入本地 .env，不要把账号写进仓库。");
  }
  return value;
}

function pageScenario(options) {
  const path = options.path;
  const url = WEB_URL + path;
  const steps = [
    {
      stepIndex: 1,
      description: "打开 " + path,
      intent: "navigate",
      semanticTarget: "page",
      value: url,
    },
    {
      stepIndex: 2,
      description: "等待页面渲染",
      intent: "wait",
      semanticTarget: "等待",
      value: String(options.waitMs || 1200),
    },
  ];
  for (const extra of options.steps || []) {
    steps.push({ ...extra, stepIndex: steps.length + 1 });
  }

  return {
    id: options.id,
    name: options.name,
    module: options.module,
    layer: options.layer || "smoke",
    requiresAuth: options.requiresAuth !== false,
    optional: Boolean(options.optional),
    description: options.description || "验证" + options.name + "可打开，且核心锚点已渲染",
    targetUrl: url,
    plannedSteps: steps,
    expectedAssertions: [
      {
        assertionId: options.id + "-url",
        description: "URL 停留在 " + path,
        type: "url_contains",
        expected: path,
      },
      {
        assertionId: options.id + "-anchor",
        description: "关键锚点可见: " + options.anchor,
        type: "element_visible",
        expected: options.anchor,
        semanticTarget: options.anchor,
      },
      ...(options.assertions || []),
    ],
  };
}

export function createLoginScenario() {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (email && password) {
    return {
      id: "SCENARIO-AUTH-LOGIN",
      name: "邮箱密码登录",
      module: "auth",
      layer: "auth",
      requiresAuth: false,
      optional: false,
      description: "测试登录功能，使用电子邮箱和密码登录，验证用户进入控制台",
      targetUrl: WEB_URL + "/login",
      initialContext: {
        email,
        username: email,
        password,
      },
      expectedAssertions: [
        {
          assertionId: "assert_login_url",
          description: "成功离开登录页并进入应用",
          type: "url_contains",
          expected: "/app",
        },
      ],
    };
  }
  return {
    id: "SCENARIO-AUTH-LOGIN",
    name: "统一认证登录",
    module: "auth",
    layer: "auth",
    requiresAuth: false,
    optional: false,
    description:
      "测试登录功能，使用手机号登录系统，获取验证码并输入，验证用户进入控制台",
    targetUrl: WEB_URL + "/login",
    initialContext: {
      phone: requiredLocalEnv("TEST_PHONE"),
      password: requiredLocalEnv("TEST_OTP"),
    },
    expectedAssertions: [
      {
        assertionId: "assert_login_url",
        description: "成功离开登录页并进入应用",
        type: "url_contains",
        expected: "/app",
      },
    ],
  };
}

export function createCatalog() {
  const login = createLoginScenario();
  const pages = [
    pageScenario({
      id: "SCENARIO-PUBLIC-LOGIN-SHELL",
      name: "登录页结构",
      module: "auth",
      layer: "public",
      requiresAuth: false,
      path: "/login",
      anchor: "login-page-container-div-wrapper",
      description: "未登录时登录页、短信入口与隐私链接可见",
      assertions: [
        {
          assertionId: "login-otp-tab",
          description: "短信登录入口可见",
          type: "element_visible",
          expected: "login-page-tab-btn-otp",
          semanticTarget: "login-page-tab-btn-otp",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-PUBLIC-PRIVACY",
      name: "隐私政策",
      module: "legal",
      layer: "public",
      requiresAuth: false,
      path: "/privacy",
      anchor: "privacy-page-container",
    }),
    pageScenario({
      id: "SCENARIO-PUBLIC-DEMO-PRODUCT",
      name: "演示商品落地页",
      module: "landing",
      layer: "public",
      requiresAuth: false,
      path: "/demo/shop/product/product-1",
      anchor: "mock-product-landing-btn-buy-now",
    }),
    pageScenario({
      id: "SCENARIO-PUBLIC-DEMO-COUPON",
      name: "演示优惠券落地页",
      module: "landing",
      layer: "public",
      requiresAuth: false,
      path: "/demo/shop/coupon",
      anchor: "mock-coupon-landing-btn-claim",
    }),
    pageScenario({
      id: "SCENARIO-PUBLIC-LEAD-CAPTURE",
      name: "公开留资页",
      module: "landing",
      layer: "public",
      requiresAuth: false,
      optional: true,
      path: "/lead-capture/qa-regression-form",
      anchor: "lead-capture-page-container",
      description: "公开留资页容器可渲染；无效表单号不计入门禁",
    }),
    pageScenario({
      id: "SCENARIO-HOME",
      name: "首页总览",
      module: "home",
      path: "/app",
      anchor: "home-page-container",
      assertions: [
        {
          assertionId: "home-manual-link",
          description: "首页提供使用手册入口",
          type: "element_visible",
          expected: "home-page-link-manual",
          semanticTarget: "home-page-link-manual",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-MANUAL",
      name: "应用内使用手册",
      module: "manual",
      path: "/app/manual",
      anchor: "manual-page-container",
    }),
    pageScenario({
      id: "SCENARIO-CAMPAIGNS",
      name: "行销活动列表",
      module: "campaign",
      path: "/app/campaigns",
      anchor: "campaign-list-page-header-title",
      assertions: [
        {
          assertionId: "campaign-create-entry",
          description: "新建活动入口可见",
          type: "element_visible",
          expected: "campaign-list-page-header-btn-create",
          semanticTarget: "campaign-list-page-header-btn-create",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-CAMPAIGN-CREATE",
      name: "新建活动编排页",
      module: "campaign",
      layer: "functional",
      path: "/app/campaigns/new",
      anchor: "campaign-create-page-input-name",
      description: "打开新建活动页并确认名称输入，不保存、不发送",
    }),
    pageScenario({
      id: "SCENARIO-CAMPAIGN-ARCHIVED-TAB",
      name: "活动归档页签",
      module: "campaign",
      layer: "functional",
      path: "/app/campaigns",
      anchor: "campaign-list-page-tab-archived",
      steps: [
        {
          description: "切换到归档页签",
          intent: "click",
          semanticTarget: "testid:campaign-list-page-tab-archived",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-TEMPLATES",
      name: "讯息范本",
      module: "template",
      path: "/app/message-templates",
      anchor: "template-list-page-header-btn-create",
    }),
    pageScenario({
      id: "SCENARIO-TEMPLATE-SEARCH",
      name: "范本搜索",
      module: "template",
      layer: "functional",
      path: "/app/message-templates",
      anchor: "template-list-page-filter-input-search",
      steps: [
        {
          description: "输入搜索词，不新建范本",
          intent: "fill",
          semanticTarget: "testid:template-list-page-filter-input-search",
          value: "qa",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-CONTACTS",
      name: "联络人列表",
      module: "contact",
      path: "/app/contacts",
      anchor: "contact-list-page-filter-input-search",
      assertions: [
        {
          assertionId: "contact-import",
          description: "Excel 导入入口可见",
          type: "element_visible",
          expected: "contact-list-page-header-btn-import-excel",
          semanticTarget: "contact-list-page-header-btn-import-excel",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-CONTACT-SEARCH",
      name: "联络人搜索",
      module: "contact",
      layer: "functional",
      path: "/app/contacts",
      anchor: "contact-list-page-filter-reachability-tabs",
      steps: [
        {
          description: "搜索联络人，不新建、不删除",
          intent: "fill",
          semanticTarget: "testid:contact-list-page-filter-input-search",
          value: "qa",
        },
        {
          description: "切换可触达页签",
          intent: "click",
          semanticTarget: "testid:contact-list-page-filter-tab-reachable",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-SEGMENTS",
      name: "分众列表",
      module: "audience",
      path: "/app/audience-segments",
      anchor: "segment-list-page-header-btn-create-segment",
    }),
    pageScenario({
      id: "SCENARIO-SEGMENT-MODAL",
      name: "分众新建弹窗",
      module: "audience",
      layer: "functional",
      path: "/app/audience-segments",
      anchor: "segment-modal-select-channel-diagnosis",
      description: "打开分众新建弹窗，不保存",
      steps: [
        {
          description: "打开新建分众弹窗",
          intent: "click",
          semanticTarget: "testid:segment-list-page-header-btn-create-segment",
        },
        {
          description: "等待弹窗",
          intent: "wait",
          semanticTarget: "等待",
          value: "700",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-TAGS",
      name: "标签中心",
      module: "tag",
      path: "/app/tags",
      anchor: "tag-center-page-header-btn-create-tag",
      assertions: [
        {
          assertionId: "tag-tabs",
          description: "标签分类页签可见",
          type: "element_visible",
          expected: "tag-center-page-filter-tab-general",
          semanticTarget: "tag-center-page-filter-tab-general",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-TAG-FILTER",
      name: "标签分类筛选",
      module: "tag",
      layer: "functional",
      path: "/app/tags",
      anchor: "tag-center-page-filter-tab-smart",
      steps: [
        {
          description: "切换智能标签页签，不新建标签",
          intent: "click",
          semanticTarget: "testid:tag-center-page-filter-tab-smart",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-SCORING",
      name: "客户评分",
      module: "scoring",
      path: "/app/customer-scoring",
      anchor: "customer-scoring-page-tier-cards-container",
    }),
    pageScenario({
      id: "SCENARIO-JOURNEYS",
      name: "自动化旅程",
      module: "journey",
      path: "/app/journeys",
      anchor: "journeys-page-list-container",
    }),
    pageScenario({
      id: "SCENARIO-JOURNEY-CANVAS",
      name: "旅程画布",
      module: "journey",
      layer: "functional",
      path: "/app/journeys/new/canvas",
      anchor: "journey-canvas-page-header-container",
      description: "打开空白旅程画布，不保存、不启用",
    }),
    pageScenario({
      id: "SCENARIO-INSIGHTS",
      name: "成效总览",
      module: "insights",
      path: "/app/insights/overview",
      anchor: "insights-page-container",
    }),
    pageScenario({
      id: "SCENARIO-OMNICHANNEL",
      name: "全渠道成效",
      module: "insights",
      path: "/app/insights/omnichannel",
      anchor: "omnichannel-analytics-page-container",
    }),
    pageScenario({
      id: "SCENARIO-RECONCILIATION",
      name: "月度对账",
      module: "ecommerce",
      path: "/app/reconciliation",
      anchor: "reconciliation-page-container",
    }),
    pageScenario({
      id: "SCENARIO-AI",
      name: "AI 助手表单",
      module: "ai",
      path: "/app/ai",
      anchor: "ai-assistant-page-input-product-name",
      description: "确认 AI 助手输入区可见，不调用生成接口",
    }),
    pageScenario({
      id: "SCENARIO-SHOPLINE",
      name: "电商中枢",
      module: "shopline",
      path: "/app/shopline",
      anchor: "shopline-hub-page-tabs-container",
    }),
    pageScenario({
      id: "SCENARIO-SHOPLINE-CATALOG",
      name: "电商商品页签",
      module: "shopline",
      layer: "functional",
      path: "/app/shopline",
      anchor: "shopline-hub-page-tab-catalog",
      steps: [
        {
          description: "切换商品目录页签，不导入",
          intent: "click",
          semanticTarget: "testid:shopline-hub-page-tab-catalog",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-SETTINGS",
      name: "系统设置",
      module: "settings",
      path: "/app/settings",
      anchor: "settings-page-container",
    }),
    pageScenario({
      id: "SCENARIO-SETTINGS-TEAM",
      name: "设置团队页签",
      module: "settings",
      layer: "functional",
      path: "/app/settings",
      anchor: "settings-page-tab-team",
      steps: [
        {
          description: "打开团队页签，不邀请、不改角色",
          intent: "click",
          semanticTarget: "testid:settings-page-tab-team",
        },
      ],
    }),
    pageScenario({
      id: "SCENARIO-TRACKING",
      name: "网站追踪设置",
      module: "settings",
      path: "/app/settings/tracking",
      anchor: "web-tracking-page-container",
    }),
    pageScenario({
      id: "SCENARIO-CHANNELS",
      name: "渠道设置",
      module: "settings",
      path: "/app/settings/channels",
      anchor: "channel-settings-page-container",
    }),
    pageScenario({
      id: "SCENARIO-ACCOUNT",
      name: "账号页",
      module: "account",
      path: "/app/account",
      anchor: "account-page-container",
    }),
    pageScenario({
      id: "SCENARIO-ADMIN",
      name: "平台系统管理",
      module: "admin",
      layer: "admin",
      optional: true,
      path: "/app/admin/system-settings",
      anchor: "platform-admin-page-container",
      description: "仅超级管理员可进入；无权限时记为跳过",
    }),
    pageScenario({
      id: "SCENARIO-DEV-MANUALS",
      name: "开发者手册",
      module: "admin",
      layer: "admin",
      optional: true,
      path: "/app/admin/developer-manuals",
      anchor: "developer-manuals-page-container",
    }),
    pageScenario({
      id: "SCENARIO-ONBOARDING",
      name: "开通引导",
      module: "onboarding",
      layer: "admin",
      optional: true,
      path: "/onboarding",
      anchor: "onboarding-page-container-div-wrapper",
      description: "已有工作区的账号可能被重定向，不计入门禁",
    }),
    pageScenario({
      id: "SCENARIO-EMBED",
      name: "嵌入壳鉴权门",
      module: "embed",
      layer: "admin",
      optional: true,
      requiresAuth: false,
      path: "/embed/main",
      anchor: "campaign-list-page-header-title",
      description: "无 AIFF 宿主令牌时允许跳转登录，不计入门禁",
    }),
  ];

  return [login, ...pages];
}

export function selectScenarios(catalog, suite = process.env.SUITE || "all") {
  const normalized = suite.toLowerCase();
  if (normalized === "all") return catalog;
  if (normalized === "public") return catalog.filter((item) => item.layer === "public" || item.layer === "auth");
  if (normalized === "smoke") {
    return catalog.filter((item) => ["auth", "public", "smoke"].includes(item.layer));
  }
  if (normalized === "functional") {
    return catalog.filter((item) => item.layer === "auth" || item.layer === "functional");
  }
  if (normalized === "admin") {
    return catalog.filter((item) => item.layer === "auth" || item.layer === "admin");
  }
  return catalog.filter((item) => item.layer === normalized || item.id === normalized || item.module === normalized);
}

export function detailScenario(kind, testId, path) {
  return pageScenario({
    id: kind === "contact" ? "SCENARIO-CONTACT-DETAIL" : "SCENARIO-CAMPAIGN-DETAIL",
    name: kind === "contact" ? "联络人详情" : "活动详情",
    module: kind === "contact" ? "contact" : "campaign",
    layer: "functional",
    path: "/app/" + (kind === "contact" ? "contacts" : "campaigns"),
    anchor: kind === "contact" ? "contact-list-page-filter-input-search" : "campaign-list-page-header-title",
    description: "从列表打开第一条" + (kind === "contact" ? "联络人" : "活动") + "详情，不修改资料",
    steps: [
      {
        description: "打开第一条详情",
        intent: "click",
        semanticTarget: "testid:" + testId,
      },
      {
        description: "等待详情渲染",
        intent: "wait",
        semanticTarget: "等待",
        value: "1000",
      },
    ],
    assertions: [
      {
        assertionId: kind + "-detail-url",
        description: "进入详情路径",
        type: "url_contains",
        expected: path,
      },
      {
        assertionId: kind + "-detail-anchor",
        description: "详情容器可见",
        type: "element_visible",
        expected: kind === "contact" ? "contact-detail-page-container" : "campaign-detail-page-container",
        semanticTarget: kind === "contact" ? "contact-detail-page-container" : "campaign-detail-page-container",
      },
    ],
  });
}
