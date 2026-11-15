// Runs before `npm start`. Hosts that skip the build step still get the site:
// if dist/ is missing, build it once (without the type check, to start faster).
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync("dist/index.html")) {
  console.info("[Startup City] dist/ not found, building the site once");
  execSync("npx vite build", { stdio: "inherit" });
}
