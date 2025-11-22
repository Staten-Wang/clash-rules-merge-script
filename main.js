const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const vm = require('vm');

/**
 * 新增函数：使用 VM 加载没有 exports 的文件并提取 main 函数
 */
function loadMainFromConfig(filePath) {
  const absPath = path.resolve(filePath);
  const code = fs.readFileSync(absPath, 'utf8');
  // 2. 准备沙箱环境
  // 我们需要把 console, require 等常用全局变量传进去，
  // 否则 config.js 里如果用了 console.log 或 require 会报错
  const sandbox = {
    console: console,
    require: require,
    process: process,
    __dirname: path.dirname(absPath),
    __filename: absPath,
    // 如果 config.js 里有 module.exports = ... 的写法（虽然它可能没生效），
    // 添加下面两行可以防止报错
    module: {},
    exports: {}
  };
  // 3. 创建上下文并运行代码
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  // 4. 从沙箱中获取 main 函数
  if (typeof sandbox.main !== 'function') {
    throw new Error(`在 ${filePath} 中未找到名为 main 的函数`);
  }
  return sandbox.main;
}


function yamlFileToJsonSync(yamlPath) {
  const absYamlPath = path.resolve(yamlPath);
  const content = fs.readFileSync(absYamlPath, 'utf8');
  const data = yaml.load(content); // 解析 YAML 为 JS 对象
  return data;
}

function jsonToYamlFileSync(input, outPath) {
  // 如果是字符串，尝试解析为对象
  let obj;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch (e) {
      throw new Error('输入是字符串但不是有效的 JSON：' + e.message);
    }
  } else {
    obj = input;
  }
  // 将对象转换为 YAML 文本
  const yamlStr = yaml.dump(obj, {
    sortKeys: false,   // 是否对键排序（设为 true 会按键名排序）
    noRefs: true,      // 禁用引用锚点
    lineWidth: 120     // 换行宽度，设为 0 可禁用折行
  });
  // 确保目录存在
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // 写入文件（utf8）
  fs.writeFileSync(outPath, yamlStr, 'utf8');
}

// CLI 用法： node yaml-to-json.js input.yaml output.json
if (require.main === module) {
  const input = './test.yaml';  
  const output = './output.yaml'; 
  const configPath = './config.js'; 

  try {
    const main = loadMainFromConfig(configPath);
    const obj = yamlFileToJsonSync(input);
    const new_obj = main(obj)
    jsonToYamlFileSync(new_obj,output)
    console.log('Converted successfully. Result object:');
    console.log(JSON.stringify(new_obj['proxy-groups'], null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(2);
  }
}

