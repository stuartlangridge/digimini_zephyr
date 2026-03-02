import { WebC } from "@11ty/webc";
import { writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";

// create WebC object
let page = new WebC();

// tell it where our components are
page.defineComponents("components/*.webc");
// have it collect style and script 
// elements all together
page.setBundlerMode(true);
// this is the page to read and 
// populate with components
page.setInputPath("shell.html");

// actually do the work
let {
    html, css, js, components
} = await page.compile();

// haha who needs webpack? not me!
// just stick the js and css inline
const out_js = `<script>
${js.join("\n")}
</script>`
const out_css = `<style>
${css.join("\n")}
</style>`
const out = html
    .replace("</body>", 
        out_js + "</body>")
    .replace("</head>", 
        out_css + "</head>");

rmSync('./_build', {recursive: true, force: true});
mkdirSync('./_build')
writeFileSync("./_build/index.html", out);
mkdirSync('./_build/static')
cpSync('./static/', './_build/static/', {recursive: true})