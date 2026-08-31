const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const db = new Database("data/db2.sqlite");

const sourceBase = "G:/trae/全部_六个风格_72个文件";
const targetBase = "data/skills/art_skills";

const styles = [
  {
    folder: "Rick_Morty_adult_animation",
    testName: "Rick_Morty_adult_animation-test",
    label: "美式成人动画风格说明（瑞克和莫提画风版）-test"
  },
  {
    folder: "Korean_comedy_live_action",
    testName: "Korean_comedy_live_action-test",
    label: "搞笑韩剧真人版风格说明-test"
  },
  {
    folder: "Chinese_horror_comic",
    testName: "Chinese_horror_comic-test",
    label: "国产恐怖搞笑条漫风格说明（中国惊奇先生画风版）-test"
  },
  {
    folder: "Marvel_superhero_comic",
    testName: "Marvel_superhero_comic-test",
    label: "美式超级英雄漫画风格说明（漫威画风版）-test"
  },
  {
    folder: "Marvel_superhero_live_action",
    testName: "Marvel_superhero_live_action-test",
    label: "美式超级英雄真人电影风格说明-test"
  },
  {
    folder: "Wong_Kar_wai_film",
    testName: "Wong_Kar_wai_film-test",
    label: "王家卫电影风格说明-test"
  }
];

// 先清理由我们新增的 test 记录（若有），以便重新统一维护
db.prepare("DELETE FROM o_artStyle WHERE name LIKE ?").run("%-test");

// 获取当前最大 ID
let maxRow = db.prepare("SELECT MAX(id) as maxId FROM o_artStyle").get();
let nextId = (maxRow && maxRow.maxId ? maxRow.maxId : 0) + 1;

for (const s of styles) {
  const srcDir = path.join(sourceBase, s.folder);
  const destDir = path.join(targetBase, s.testName);
  
  if (!fs.existsSync(srcDir)) {
    console.error("Source not found: " + srcDir);
    continue;
  }
  
  // 确保目标目录存在
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
  
  // 确保 images 目录和封面存在
  const imgDir = path.join(destDir, "images");
  fs.mkdirSync(imgDir, { recursive: true });
  const sampleImg = "data/skills/art_skills/2D_90s_japanese_anime/images/1.png";
  if (fs.existsSync(sampleImg)) {
    fs.copyFileSync(sampleImg, path.join(imgDir, "1.png"));
  }
  
  // 更新 README.md 中的标题为 test
  const readmePath = path.join(destDir, "README.md");
  if (fs.existsSync(readmePath)) {
    let content = fs.readFileSync(readmePath, "utf-8");
    content = content.replace(/^#\s+(.+)$/m, "# $1 (test)");
    fs.writeFileSync(readmePath, content, "utf-8");
  }
  
  // 读取 prefix.md
  const prefixPath = path.join(destDir, "prefix.md");
  const prompt = fs.existsSync(prefixPath) ? fs.readFileSync(prefixPath, "utf-8") : "";
  
  // 插入数据库
  db.prepare("INSERT INTO o_artStyle (id, name, fileUrl, label, prompt) VALUES (?, ?, ?, ?, ?)").run(
    nextId++,
    s.testName,
    "",
    s.label,
    prompt
  );
  console.log("[OK] Created & registered " + s.testName + " (ID: " + (nextId - 1) + ")");
}

console.log("=== 当前数据库 o_artStyle 总表 ===");
console.log(db.prepare("SELECT id, name, label FROM o_artStyle").all());
