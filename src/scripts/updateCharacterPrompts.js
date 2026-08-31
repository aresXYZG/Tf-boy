const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '../../data/skills/art_skills');
const dirs = fs.readdirSync(base);

const styleMeta = {
  "2D_90s_japanese_anime": {
    name: "90年代复古日系动画风格",
    stylePrompt: "90年代复古日系赛璐璐动画风格，手绘赛璐璐质感，柔和复古颗粒，复古胶片色调，复古动漫分镜感，retro 90s anime style, hand-drawn cel shading, vintage anime aesthetic"
  },
  "2D_chinese_guofeng": {
    name: "新国风水墨工笔手绘风格",
    stylePrompt: "新国风水墨工笔手绘风格，细腻墨线勾勒，淡彩晕染，国风工笔意境，优雅古典美学，Chinese guofeng watercolor illustration style, delicate ink outlines, elegant brushwork"
  },
  "2D_flat_design": {
    name: "极简现代扁平插画风格",
    stylePrompt: "现代极简扁平插画风格，几何概括线条，纯色色块平涂，清晰轮廓，现代矢量美学，modern flat vector illustration style, clean geometric shapes, minimalist color palette"
  },
  "2D_mature_urban_romance": {
    name: "二次元唯美都会漫画风格",
    stylePrompt: "二次元唯美都会漫画风格，精致日漫线稿，细腻赛璐璐光影，高光透亮发丝，都市浪漫美学，modern anime manga illustration style, fine line art, luminous hair highlights"
  },
  "3D_anime_render": {
    name: "3D日系高精度动漫渲染风格",
    stylePrompt: "3D日系动漫精细渲染风格，次世代卡通次表面渲染(NPR)，精细发丝模型，清透眼眸折射，柔和摄影棚布光，high quality 3D anime CGI rendering, stylized PBR materials, soft studio lighting"
  },
  "3D_chinese_traditional": {
    name: "3D次世代国风CG渲染风格",
    stylePrompt: "3D次世代国风CG建模渲染风格，次世代PBR织物纹理，高精度刺绣凹凸，发丝级发型渲染，电影级体积光，cinematic 3D Chinese traditional CGI render, realistic fabric shaders"
  },
  "3D_clay_stopmotion": {
    name: "黏土定格动画手作风格",
    stylePrompt: "黏土定格动画风格，真实手工黏土指纹压痕，黏土微粒质感，定格动画微缩微距摄影，温暖侧光照明，clay stop-motion animation style, tactile plasticine fingerprints, macro photography lighting"
  },
  "3D_guofeng_cyber": {
    name: "3D国风赛博霓虹科幻风格",
    stylePrompt: "3D国风赛博朋克科幻风格，高精金属机甲与国风丝绸结合，全息光效，霓虹夜景反射，电影级光线追踪渲染，cinematic 3D cyberpunk Chinese aesthetic, ray-traced reflections, holographic glow"
  },
  "Chinese_horror_comic": {
    name: "国产恐怖搞笑条漫风格",
    stylePrompt: "国产恐怖搞笑条漫风格，细腻手绘墨线，写实骨相与夸张神态结合，暗色调阴郁氛围，条漫分镜感，Chinese horror comedy webcomic style, delicate dark ink lineart, gritty atmospheric tones"
  },
  "Korean_comedy_live_action": {
    name: "搞笑韩剧真人影视实拍风格",
    stylePrompt: "搞笑韩剧真人影视实拍风格，35mm电影摄影机质感，真实清透韩国电视剧打光，真实人像皮肤质感与微表情，Korean comedy drama live-action photography, 35mm film still, soft commercial lighting"
  },
  "Marvel_superhero_comic": {
    name: "美式超级英雄经典美漫画风",
    stylePrompt: "美式超级英雄经典漫画风格，美漫粗犷动态墨线，强烈交叉排线阴影(Cross-hatching)，美式四色网点印刷质感，高饱和美漫对比色，classic American superhero comic book style, bold black ink shadows, halftone dots"
  },
  "Marvel_superhero_live_action": {
    name: "美式超级英雄大片电影质感",
    stylePrompt: "美式超级英雄真人电影大片风格，IMAX胶片电影质感，超写实战衣材质与金属光泽，真实人像毛孔与肌肉线条，好莱坞电影工业布光，Hollywood superhero cinematic movie still, IMAX cinematography, ultra-detailed texture"
  },
  "realpeople_ancient_chinese": {
    name: "古装影视真人实拍剧照风格",
    stylePrompt: "古装历史影视剧真人实拍摄影，电影级摄影棚柔光，真实影视化妆容，真实布料与刺绣质感，自然电影胶片颗粒，cinematic historical Chinese drama film still, realistic portrait photography"
  },
  "realpeople_modern_city": {
    name: "现代都市真人实拍摄影风格",
    stylePrompt: "现代都市真人实拍人像摄影，中灰背景纸棚拍柔光，真实自然素颜皮肤毛孔纹理，自然日常体态，35mm全画幅纪实摄影质感，candid live-action photography, 35mm full frame portrait, studio grey backdrop"
  },
  "realpeople_urban_modern": {
    name: "都市写真影视实拍风格",
    stylePrompt: "都市影视写实人像摄影风格，胶片人像质感，柔和漫反射光影，真实皮肤微瑕与通透光泽，生活化真实人物神态，natural urban cinematic portrait photography, authentic skin texture, soft diffusion light"
  },
  "Rick_Morty_adult_animation": {
    name: "美式成人动画手绘讽刺风格",
    stylePrompt: "美式成人动画手绘风格，粗犷手绘黑线描边，高饱和纯色平涂，夸张非对称五官神态，赛璐璐无渐变色块，American adult animation style, bold black outlines, flat solid colors, expressive exaggerated features"
  },
  "Wong_Kar_wai_film": {
    name: "王家卫电影胶片暧昧光影风格",
    stylePrompt: "王家卫电影胶片风格，浅景深虚化，霓虹灯红绿强烈冷暖对比，雨夜烟雾氤氲，迷离眼神与暧昧故事感，胶片颗粒质感，Wong Kar-wai film aesthetic, neon color contrast, dreamy shallow depth of field, atmospheric haze"
  }
};

const nl = '
';

dirs.forEach(d => {
  const pChar = path.join(base, d, "art_prompt", "art_character.md");
  if (!fs.existsSync(pChar)) return;
  const meta = styleMeta[d] || { name: d, stylePrompt: `${d} style` };

  const promptTemplateSection = [
    "## 八、提示词模板",
    "",
    `{性别}角色四视图设定图，${meta.name}，${meta.stylePrompt}，`,
    "character design sheet, character turnaround,",
    "【双真人参考图融合】：全新原创{人种}{年龄段}{性别}角色，融合两张真人参考底图（图2主要参考70%面部五官排布、眼型神采与神韵气质；图1辅助参考30%骨相立体度、下颌线轮廓与皮肤通透细腻质感），杜绝千篇一律AI脸，",
    "{角色描述对应的五官特征 - 由剧本设定自然推导}，{整体气质与神态}，",
    "{肤色描述}，{画风对应肤质与材质表现}，",
    "{身高描述，如：175cm tall}，{头身比描述，如：7 heads tall proportion}，{体型描述}，{体态描述}，",
    "{发色}{发长}，{发型与发质细节}，",
    "{角色身份对应的常规着装}，{主服色}，{服装材质与纹理质感}，",
    "同一画面从左至右横排四视图：左一人像超大高清特写（正面平视，头顶至锁骨完整展示，面部占比60%+，锁定双垫图融合之高精面容细节） + 左二正视图无头全身立像（颈部以下至脚底，headless body，颈部以上完全截断留空不画头部，锁定体型与服装正面全貌） + 右二侧视图无头全身立像（颈部以下至脚底，headless body，颈部以上完全截断留空不画头部，锁定体态与侧面层次） + 右一后视图全身立像（后方180°，完整呈现后脑发型、发尾、背部服装版型与鞋底），",
    "自然站立，纯净中性灰背景 #808080，均匀柔光，自然阴影，",
    "四视图高度一致性，面容生动有辨识度，发丝与服饰纹理细腻，",
    "图中不要有任何文字"
  ].join(nl);

  let content = fs.readFileSync(pChar, "utf8");
  const regex = /## (?:八|九)、提示词模板[\s\S]*?(?=## (?:九|十)、约束规则)/;
  if (regex.test(content)) {
    content = content.replace(regex, promptTemplateSection + nl + nl + "---" + nl + nl);
    fs.writeFileSync(pChar, content, "utf8");
    console.log("Injected Dual-Ref prompt template into:", d);
  }
});
