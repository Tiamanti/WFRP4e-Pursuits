import fs from "fs"
import copy from "rollup-plugin-copy-watch"

let modulePath
try {
    const { default: foundryPath } = await import("./foundry-path.js")
    modulePath = foundryPath()
} catch {
    modulePath = "./dist"
}
const manifest = JSON.parse(fs.readFileSync("./module.json", "utf-8"))
const moduleId = manifest.id

console.log("Bundling " + moduleId + " to " + modulePath)

const isProduction = process.env.NODE_ENV === "production"

export default {
    input: `./src/${moduleId}.mjs`,
    output: {
        file: `${modulePath}/scripts/${moduleId}.mjs`,
        format: "es"
    },
    watch: {
        clearScreen: true
    },
    plugins: [
        copy({
            targets: [
                { src: "module.json", dest: modulePath },
                { src: "languages/*", dest: `${modulePath}/languages` },
                { src: "styles/*", dest: `${modulePath}/styles` },
                { src: "templates", dest: modulePath }
            ],
            watch: isProduction ? false : ["languages/**", "styles/**", "module.json", "templates/**"]
        })
    ]
}