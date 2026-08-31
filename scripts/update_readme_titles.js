const fs = require("fs");
const path = require("path");

const baseDir = "data/skills/art_skills";
const dirs = fs.readdirSync(baseDir);

for (const d of dirs) {
  if (d.endsWith("-test")) {
    const readmePath = path.join(baseDir, d, "README.md");
    if (fs.existsSync(readmePath)) {
      let content = fs.readFileSync(readmePath, "utf-8");
      const newline = content.includes("
") ? "
" : "
";
      const lines = content.split(newline);
      if (lines[0] && !lines[0].includes("-test")) {
        lines[0] = lines[0].trim() + "-test";
        fs.writeFileSync(readmePath, lines.join(newline), "utf-8");
        console.log(`Updated ${d} -> "${lines[0]}"`);
      } else {
        console.log(`Keep ${d} -> "${lines[0]}"`);
      }
    }
  }
}
