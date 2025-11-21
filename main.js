const { main: main } = require('./config');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');


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
  try {
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

// 如果你想在命令行接收文件路径、或写回文件，可在这里扩展
