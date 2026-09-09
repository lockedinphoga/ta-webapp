import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Tells Next's bundler (Turbopack) explicitly which folder is the real
  // root of this project. Without this, Turbopack tries to guess the root
  // by walking upward looking for lockfiles — and if it finds a stray
  // package-lock.json somewhere above this folder (e.g. accidentally
  // created in your Windows user folder, C:\Users\<you>, by running
  // `npm install` there once by mistake), it gets confused and prints a
  // warning like "Next.js ignored package-lock.json in C:\Users\... because
  // it would include your home directory." Pinning the root here avoids
  // that guesswork entirely. This is harmless even if you never hit that
  // warning, so it's safe to leave in.
  turbopack: {
    root: __dirname,
  },
  // chartjs-node-canvas depends on the native "canvas" package, which uses
  // dynamic requires that confuse Next's server bundler. Marking these as
  // external tells Next to load them normally via Node's require at
  // runtime instead of trying to bundle them.
  //
  // "chart.js" and "chartjs-plugin-annotation" MUST be listed here too:
  // chartjs-node-canvas loads its own internal copy of chart.js via a plain
  // require('chart.js/auto'). If we let Next's bundler separately bundle
  // OUR "chart.js" / "chartjs-plugin-annotation" imports (used to register
  // the annotation plugin), we end up with two different Chart.js
  // instances in memory — the plugin registers itself on one, but
  // chartjs-node-canvas renders with the other, so the chart it draws never
  // sees the plugin's default options. That mismatch is what caused the
  // "Cannot read properties of undefined (reading 'borderCapStyle')" crash.
  // Keeping all packages that touch Chart.js external forces everyone to
  // share the same single required instance, the way plain Node.js would.
  //
  // "chartjs-chart-financial" (candlesticks) is deliberately NOT listed
  // here — Turbopack refuses to treat it as external (its package.json is
  // set up in a way it considers "invalid" for that). Instead,
  // lib/renderChart.ts loads it via a genuine, un-bundled Node `require()`
  // (see the comments there) so it shares this same "chart.js" instance.
  // "chartjs-adapter-date-fns" isn't used at all — see lib/renderChart.ts.
  serverExternalPackages: ["chartjs-node-canvas", "canvas", "chart.js", "chartjs-plugin-annotation"],

  // WHY THIS EXISTS: when you deploy to Vercel, it doesn't just copy your
  // whole node_modules folder — it scans your code first to figure out
  // exactly which files from node_modules are actually used, and only
  // uploads those (this keeps deployments small and fast to start; this
  // scanning step is called "file tracing"). Normally that scan works by
  // looking for `require(...)` / `import` calls with the package name
  // written out as plain text.
  //
  // But lib/renderChart.ts deliberately loads chartjs-chart-financial
  // using `eval("require")(...)` instead of a normal `require(...)` — see
  // the big comment there for why (short version: it needs to dodge
  // Turbopack's bundler, which breaks this specific package). The
  // side effect is that the file-tracing scan can't see that reference
  // either, since it's hidden behind eval() on purpose — so on Vercel,
  // the chartjs-chart-financial files were silently left out of the
  // deployment, causing "Cannot find module
  // 'chartjs-chart-financial/dist/chartjs-chart-financial.js'" at
  // runtime (this worked fine with `npm run dev` locally, because
  // locally there's no separate "upload only what's traced" step — every
  // file in node_modules is already sitting right there on disk).
  //
  // This setting manually forces those files to be included regardless,
  // for the one route that needs them.
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/chartjs-chart-financial/dist/**"],
  },
};

export default nextConfig;
