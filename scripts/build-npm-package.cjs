#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = require("../apps/cli/package.json");
const output = path.join(root, "release/npm");
fs.mkdirSync(output, { recursive: true });
const stage = fs.mkdtempSync(path.join(output, "package-"));
try {
  // Bundle from disposable sources so tests cannot fall back to the developer build.
  const sources = path.join(stage, "source");
  fs.mkdirSync(sources);
  fs.cpSync(path.join(root, "apps/cli/dist/src"), path.join(sources, "src"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(root, "apps/cli/package.json"),
    path.join(sources, "package.json")
  );
  const entry = path.join(stage, "cli.cjs");
  const metafile = path.join(stage, "metafile.json");
  execFileSync(
    process.env.BUN_EXECUTABLE || "bun",
    [
      "build",
      path.join(sources, "src/index.js"),
      "--target=node",
      "--format=cjs",
      `--outfile=${entry}`,
      `--metafile=${metafile}`,
    ],
    { cwd: root, stdio: "inherit" }
  );
  fs.chmodSync(entry, 0o755);
  const metadata = JSON.parse(fs.readFileSync(metafile, "utf8"));
  const packages = new Map();
  for (const input of Object.keys(metadata.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let directory = path.dirname(path.resolve(root, input));
    while (directory !== root) {
      const manifest = path.join(directory, "package.json");
      if (fs.existsSync(manifest)) {
        const info = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (info.name && info.version) {
          packages.set(directory, info);
          break;
        }
      }
      const parent = path.dirname(directory);
      assert.notEqual(
        parent,
        directory,
        `Cannot identify dependency: ${input}`
      );
      directory = parent;
    }
    assert.notEqual(directory, root, `Cannot identify dependency: ${input}`);
  }
  const notices = [
    "# Bundled third-party notices\n",
    "These dependencies retain their original ownership and licensing.\n",
    "The bundled MCP SDK includes the cancellation correction in the source repository’s Yarn patch.\n",
  ];
  for (const [directory, info] of [...packages].sort((a, b) =>
    `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`)
  )) {
    notices.push(
      `## ${info.name}@${info.version}\n`,
      `Declared license: ${info.license || "not specified"}\n`
    );
    const licenses = fs
      .readdirSync(directory)
      .filter(
        (name) =>
          /^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(name) &&
          fs.statSync(path.join(directory, name)).isFile()
      );
    if (licenses.length === 0) {
      // Preserve missing upstream declarations rather than inventing a license.
      assert.equal(info.license, "None", `Missing license text: ${info.name}`);
      notices.push(
        `Upstream ships no license text. Source: ${info.homepage}\n`
      );
    }
    for (const name of licenses)
      notices.push(
        `### ${name}\n\n\`\`\`text\n${fs
          .readFileSync(path.join(directory, name), "utf8")
          .trim()}\n\`\`\`\n`
      );
  }
  fs.writeFileSync(
    path.join(stage, "THIRD_PARTY_NOTICES.md"),
    notices.join("\n")
  );
  for (const name of ["LICENSE", "CREDITS.md"])
    fs.copyFileSync(path.join(root, name), path.join(stage, name));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  fs.writeFileSync(
    path.join(stage, "README.md"),
    readme.replace(
      /\]\(([^:)#]+)\)/g,
      (_, target) =>
        `](https://github.com/danielbaars/anthracite/blob/v${source.version}/${target})`
    )
  );
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify(
      {
        name: source.name,
        version: source.version,
        description:
          "Stacked Git branches and GitHub pull requests, with local MCP support",
        license: source.license,
        homepage: source.homepage,
        repository: {
          type: "git",
          url: "git+https://github.com/danielbaars/anthracite.git",
        },
        bugs: source.bugs,
        engines: { node: ">=24" },
        bin: { an: "cli.cjs", anthracite: "cli.cjs" },
        files: [
          "cli.cjs",
          "README.md",
          "LICENSE",
          "CREDITS.md",
          "THIRD_PARTY_NOTICES.md",
        ],
        publishConfig: { access: "public" },
      },
      null,
      2
    ) + "\n"
  );
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        stage,
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        output,
      ],
      { cwd: root, encoding: "utf8" }
    )
  );
  const tarball = path.join(output, packed[0].filename);
  fs.copyFileSync(tarball, path.join(output, "danielbaars-anthracite.tgz"));
  fs.writeFileSync(
    path.join(output, "SHA256SUMS"),
    createHash("sha256").update(fs.readFileSync(tarball)).digest("hex") +
      "  danielbaars-anthracite.tgz\n"
  );
  console.log(`Packaged ${source.name}@${source.version}: ${tarball}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
