
const BEST_PROXY_TOLERANCE = 100

const prependRule = [
  "DOMAIN-KEYWORD,adobe,REJECT",
  "DOMAIN-KEYWORD,aihubmix,DIRECT",
  "DOMAIN-SUFFIX,bing.com,DIRECT",
  "DOMAIN-KEYWORD,lingva,DIRECT",
  "DOMAIN-KEYWORD,openreview,DIRECT",
  // "DOMAIN-KEYWORD,ieeexplore,DIRECT",

  // "DOMAIN-SUFFIX,infini-cloud.net,DIRECT",
];




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
};




function createAreaBestProxyGroup(groupName, proxiesList) {
  return {
    name: groupName,
    type: 'url-test',
    proxies: proxiesList.slice(), // 复制一份
    url: 'http://www.gstatic.com/generate_204',
    interval: 30,
    tolerance: BEST_PROXY_TOLERANCE,
    lazy: true
  };
}


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

function createAllAreaBestProxyGroups(config) {
  const allProxies = config['proxies']
  const proxyGroups = {};
  for (const key of Object.keys(groupMaps)) {
    proxyGroups[key] = [];
  }
  const noHitGroup = []

  const aliasToCanonical = prepareAlias()
  for (const proxy of allProxies) {
    // console.log(proxy['name']);
    let isHit = false;
    for (const key of Object.keys(aliasToCanonical)) {
      // console.log();
      if (proxy['name'].includes(key)) {
        proxyGroups[aliasToCanonical[key]].push(proxy['name']);
        isHit = true;
        break;
      }
    }
    if (!isHit) {
      noHitGroup.push(proxy['name']);
    }
  }

  console.log(`未命中分组: ${ noHitGroup.join(', ') }`);
  const areaBestProxyGroups = []
  for (const [name, proxiesList] of Object.entries(proxyGroups)) {
    if (proxiesList.length > 0) {
      nationalFlag = flagEmojis[name] ?? '🏳'
      areaBestProxyGroups.push(createAreaBestProxyGroup(`${nationalFlag}|-最优路线-|${name}`, proxiesList));
    }
  }
  return areaBestProxyGroups;
}

function addNewProxyGroupsToOldGroupsProxiesImmutable(oldGroups, newGroups, front = false) {
  if (!Array.isArray(oldGroups) || !Array.isArray(newGroups)) return oldGroups;
  const newNames = newGroups.map(g => g && g.name).filter(Boolean);
  if (newNames.length === 0) return oldGroups.slice().filter(Boolean); // 保持去掉假值的一致性

  return oldGroups
    .filter(Boolean) // 这里去掉假值的 oldGroup
    .map(oldGroup => {
      if (!isSelect(oldGroup.type)) return oldGroup;
      const proxies = Array.isArray(oldGroup.proxies) ? oldGroup.proxies.slice() : [];
      const merged = front ? [...newNames, ...proxies] : [...proxies, ...newNames];
      return { ...oldGroup, proxies: merged };
    });
}

function main(config) {
  const areaBestProxyGroups = createAllAreaBestProxyGroups(config);
  let oldrules = config["rules"];
  config["rules"] = prependRule.concat(oldrules);
  // const newProxyGroups = config['proxy-groups'];
  const newProxyGroups = addNewProxyGroupsToOldGroupsProxiesImmutable(config['proxy-groups'], areaBestProxyGroups);
  newProxyGroups.push(...areaBestProxyGroups)
  config['proxy-groups'] = newProxyGroups;
  return config;
}

function isSelect(check_str) {
  return typeof check_str === 'string' && check_str === 'select';
}

// 粘贴到clash 中记得删除下面这句话
module.exports = { main };  
