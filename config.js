const BEST_PROXY_TOLERANCE = 100;
const HEALTH_CHECK_TEST_URL = 'https://www.gstatic.com/generate_204';
const INTERVAL = 30;
const TIMEOUT = 100;
const GEOIPURL = 'https://cdn.jsdelivr.net/gh/Hackl0us/GeoIP2-CN@release/Country.mmdb';
const KEYSORDER = [
  'port', 'mixed-port', 'socks-port', 'redir-port', 'bind-address',
  'allow-lan', 'mode', 'log-level', 'external-controller',
  'unified-delay', 'tcp-concurrent', 'secret',
  'geodata-mode', 'geodata-loader', 'geo-auto-update', 'geo-update-interval', 'geox-url',
  'dns', 'proxies', 'proxy-groups',
  'rules', 'rule-providers'
];

const prependRule = [
  "DOMAIN-SUFFIX,aihubmix.com,DIRECT",
  "DOMAIN-SUFFIX,openrouter.ai,DIRECT",
  "DOMAIN-SUFFIX,aistudio.google.com,Gemini",
];


// appRuleProviders
const appRuleProviders = {
  AcademicCN: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/Staten-Wang/clash-rules-academic@main/AcademicCN/AcademicCN.yaml",
    path: "./ruleset/AcademicCN.yaml",
    interval: 86400,
  },

  AcademicDatabase: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/Staten-Wang/clash-rules-academic@main/AcademicDatabase/AcademicDatabase.yaml",
    path: "./ruleset/AcademicDatabase.yaml",
    interval: 86400,
  },

  AcademicGlobal: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/Staten-Wang/clash-rules-academic@main/AcademicGlobal/AcademicGlobal.yaml",
    path: "./ruleset/AcademicGlobal.yaml",
    interval: 86400,
  },

  AcademicProxy: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/Staten-Wang/clash-rules-academic@main/AcademicProxy/AcademicProxy.yaml",
    path: "./ruleset/AcademicProxy.yaml",
    interval: 86400,
  },

  Gemini: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Gemini/Gemini.yaml",
    path: "./ruleset/Gemini.yaml",
    interval: 86400,
  },

  Google: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Google/Google.yaml",
    path: "./ruleset/Google.yaml",
    interval: 86400,
  },

  OpenAI: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Loon/OpenAI/OpenAI.list",
    path: "./ruleset/OpenAI.yaml",
    interval: 86400,
  },

  Microsoft: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Microsoft/Microsoft.yaml",
    path: "./ruleset/Microsoft.yaml",
    interval: 86400,
  },

  SteamCN: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/SteamCN/SteamCN.yaml",
    path: "./ruleset/SteamCN.yaml",
    interval: 86400,
  },

  AdobeActivation: {
    type: "http",
    behavior: "classical",
    url: "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/AdobeActivation/AdobeActivation.yaml",
    path: "./ruleset/AdobeActivation.yaml",
    interval: 86400,
  },

};

const groupMaps = {
  "香港": ["香港", "HK", 'hk', "港专线"],
  "美国": ["美国"],
  "英国": ["英国"],
  "新加坡": ["新加坡"],
  "韩国": ["韩国"],
  "台湾": ["台湾"],
  "日本": ["日本"],
  "印度": ["印度"],
  "迪拜": ["迪拜"],
  "德国": ["德国"],
  "瑞士": ["瑞士"],
  "澳大利亚": ["澳大利亚"],
  "法国": ["法国"],
  "加拿大": ["加拿大"],
  "越南": ["越南"],
  "俄罗斯": ["俄罗斯"],
  "乌克兰": ["乌克兰"],
  "土耳其": ["土耳其"],
  "尼日利亚": ["尼日利亚"],
};


const flagEmojis = {
  "香港": "🇭🇰",
  "美国": "🇺🇸",
  "英国": "🇬🇧",
  "新加坡": "🇸🇬",
  "韩国": "🇰🇷",
  "台湾": "🇹🇼",
  "日本": "🇯🇵",
  "印度": "🇮🇳",
  "迪拜": "🇦🇪",
  "德国": "🇩🇪",
  "瑞士": "🇨🇭",
  "澳大利亚": "🇦🇺",
  "法国": "🇫🇷",
  "加拿大": "🇨🇦",
  "越南": "🇻🇳",
  "俄罗斯": "🇷🇺",
  "乌克兰": "🇺🇦",
  "土耳其": "🇹🇷",
  "尼日利亚": "🇳🇬",
};


function createSelectProxyGroup(groupName, proxyNamesList) {
  return {
    name: groupName,
    type: 'select',
    proxies: proxyNamesList.slice(), // 复制一份
    url: HEALTH_CHECK_TEST_URL,
    interval: INTERVAL,
    tolerance: BEST_PROXY_TOLERANCE,
    timeout: TIMEOUT,
    lazy: true
  };
}

function createUrlTestProxyGroup(groupName, proxyNamesList) {
  return {
    name: groupName,
    type: 'url-test',
    proxies: proxyNamesList.slice(), // 复制一份
    url: HEALTH_CHECK_TEST_URL,
    interval: INTERVAL,
    tolerance: BEST_PROXY_TOLERANCE,
    lazy: true
  };
};


function prepareAlias() {
  const aliasToCanonical = {};
  for (const canonical of Object.keys(groupMaps)) {
    const list = groupMaps[canonical] || [];
    // 保证统一名本身也能被匹配
    aliasToCanonical[canonical] = canonical;
    for (const alias of list) {
      aliasToCanonical[alias] = canonical;
    }
  }
  return aliasToCanonical
}

function createAllAreaBestProxyGroups(proxyNamesList) {
  const proxyGroups = {};
  for (const key of Object.keys(groupMaps)) {
    proxyGroups[key] = [];
  }
  const noHitGroup = []

  const aliasToCanonical = prepareAlias()
  for (const proxyName of proxyNamesList) {

    let isHit = false;
    for (const key of Object.keys(aliasToCanonical)) {
      if (proxyName.includes(key)) {
        proxyGroups[aliasToCanonical[key]].push(proxyName);
        isHit = true;
        break;
      }
    }
    if (!isHit) {
      noHitGroup.push(proxyName);
    };
  };

  console.log(`未命中分组: ${noHitGroup.join(', ')}`);
  const areaBestProxyGroups = []
  for (const [name, proxiesList] of Object.entries(proxyGroups)) {
    if (proxiesList.length > 0) {
      locationFlag = flagEmojis[name] ?? '🏳'
      areaBestProxyGroups.push(createUrlTestProxyGroup(`${locationFlag}|-最优路线-|${name}`, proxiesList));
    }
  }
  return areaBestProxyGroups;
};


function getProxyNames(proxies) {
  return (proxies || []).map(p => (p && typeof p.name !== 'undefined') ? String(p.name) : '');
};

/**
 * 根据给定的 keysOrder 对象顶层键进行重排。
 * keysOrder 中出现的键会按顺序放在结果开头，剩余键按原始对象的遍历顺序追加。
 */
function reorderKeys(obj, keysOrder) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  const used = new Set();
  for (const k of (keysOrder || [])) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      result[k] = obj[k];
      used.add(k);
    }
  }
  for (const k of Object.keys(obj)) {
    if (!used.has(k)) result[k] = obj[k];
  }
  return result;
}


function main(config) {

  // 如果已经标记为已转换，则直接返回，避免重复转换
  try {
    if (config && config.converted) return config;
  } catch (e) { }

  config['geodata-mode'] = false;
  config['geodata-loader'] = 'standard';
  config['geo-auto-update'] = true;
  config['geo-update-interval'] = 24;
  config['geox-url'] = config['geox-url'] || {};
  config['geox-url'].geoip = GEOIPURL;

  // 获取所有 代理节点的名称
  const allProxyNames = getProxyNames(config['proxies']);

  // build UseProxysGroups 
  const useProxyGroups = [];

  const allProxiesGroup = createSelectProxyGroup('独立节点', allProxyNames);
  const areaBestProxyGroups = createAllAreaBestProxyGroups(allProxyNames);
  useProxyGroups.push(allProxiesGroup, ...areaBestProxyGroups);

  const allProxyGroups = createSelectProxyGroup('代理选择', getProxyNames(useProxyGroups));
  useProxyGroups.unshift(allProxyGroups);

  const useProxyGroupNames = getProxyNames(useProxyGroups);

  // build ruleProxyGroups
  const ruleProxyGroups = [];

  const appRuleProviderRuleNames = Object.keys(appRuleProviders);
  const appRuleProxyGroups = appRuleProviderRuleNames.map(name =>
    createSelectProxyGroup(name, [...useProxyGroupNames, 'DIRECT', 'REJECT'])
  );
  ruleProxyGroups.push(...appRuleProxyGroups);

  const directProxyGroupName = ['DIRECT', ...useProxyGroupNames];
  const directProxyGroup = createSelectProxyGroup('直连', directProxyGroupName);
  ruleProxyGroups.push(directProxyGroup);

  const rejectProxyGroupName = ['REJECT', 'DIRECT', ...useProxyGroupNames];
  const rejectProxyGroup = createSelectProxyGroup('拦截', rejectProxyGroupName);
  ruleProxyGroups.push(rejectProxyGroup);


  // 汇总代理组
  const summaryProxyGroups = [];  // 汇总所有groups 给 config['proxy-groups'] 用
  summaryProxyGroups.push(...useProxyGroups, ...ruleProxyGroups);
  config['proxy-groups'] = summaryProxyGroups;


  //  rule-providers
  const allRuleProviders = { ...appRuleProviders, ...generalRuleProviders };

  config['rule-providers'] = allRuleProviders;

  // Rules
  const summaryRules = [];
  //  插入 自定义规则
  summaryRules.unshift(...(prependRule || []));


  // Build appRules
  // RULE-SET,appRuleProvidersName, appRuleProxyGroupName
  // appRuleProvidersName == appRuleProxyGroupName
  const appRules = appRuleProviderRuleNames.map(name =>
    `RULE-SET,${name},${name}`
  );
  summaryRules.push(...appRules);

  //  添加 generalRuleProviderRules
  summaryRules.push(...generalRuleProviderRules);
  // 兜底Rule, 所有未被其他规则匹配的都会被此规则捕获,必须放在最后。
  const matchRule = 'MATCH,代理选择'
  summaryRules.push(matchRule);
  config["rules"] = summaryRules;

  // 按 KEYSORDER 重排顶层键，未在 KEYSORDER 中的键保持原始顺序追加
  try {
    config = reorderKeys(config, KEYSORDER);
  } catch (e) {
    // 若重排出现异常则保持原始 config，不影响主流程
    console.error('reorderKeys failed:', e && e.message ? e.message : e);
  }

  // 标记为已转换，避免下次重复转换
  try { config.converted = true; } catch (e) { }
  return config;
}

// generalRuleProviders

const generalRuleProviderRules = [
  'RULE-SET,reject,拦截',
  'RULE-SET,private,直连',
  'RULE-SET,direct,直连',
  'RULE-SET,lancidr,直连',
  'RULE-SET,cncidr,直连',
  'GEOIP,CN,直连,no-resolve',
];

//  
const generalRuleProviders = {
  gfw: {
    type: "http",
    behavior: "domain",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt",
    path: "./ruleset/gfw.yaml",
    interval: 86400
  },

  reject: {
    type: "http",
    behavior: "domain",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt",
    path: "./ruleset/reject.yaml",
    interval: 86400
  },

  private: {
    type: "http",
    behavior: "domain",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
    path: "./ruleset/private.yaml",
    interval: 86400
  },

  direct: {
    type: "http",
    behavior: "domain",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
    path: "./ruleset/direct.yaml",
    interval: 86400
  },

  lancidr: {
    type: "http",
    behavior: "ipcidr",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt",
    path: "./ruleset/lancidr.yaml",
    interval: 86400
  },

  cncidr: {
    type: "http",
    behavior: "ipcidr",
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt",
    path: "./ruleset/cncidr.yaml",
    interval: 86400
  },
};
