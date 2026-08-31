const fs = require("fs");
const path = require("path");
const axios = require("axios");

async function run() {
  const login = await axios.post("http://localhost:10588/api/login/login", { username: "admin", password: "admin123" });
  const token = login.data.data.token;
  const headers = { Authorization: token };
  
  const res = await axios.post("http://localhost:10588/api/project/getVisualManual", {}, { headers });
  console.log("=== getVisualManual 返回的全部列表 ===");
  res.data.data.forEach(item => {
    console.log(`[${item.stylePath}] => "${item.name}"`);
  });
}

run();
