import { execSync } from "child_process";
import path = require("path");
import color = require("color");
import * as vscode from "vscode";

const DEFAULT_HEAT_COLOUR = color.rgb(200, 0, 0);
const DEFAULT_HEAT_LEVELS = 10;

const RGB_STRING_REGEXP = /^(?<r>\d{1,3}),(?<g>\d{1,3}),(?<b>\d{1,3})$/;
const HEX_STRING_REGEXP = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const heatStyles: vscode.TextEditorDecorationType[] = [];
var enabledForFiles = new Set();

/**
 * Parse a string into a color object.
 *
 * @param colorStr The string to parse. Must be in one of the formats:
 *                  * "r,g,b", where r, g, b are the color components as decimal
 * 						numbers. e.g. "200,0,0"
 * 					* "#RRGGBB", where RR, GG, BB are the color components in
 * 						hexadecimal. e.g. "#ff0000"
 * 					* "#RGB", where R, G, B are the color components in
 * 						hexadecimal. e.g. "#f00"
 * @param default_ The color object to return if the string couldn't be converted.
 * @returns A color object.*/

function colorFromString(colorStr: string, default_: color): color {
  colorStr = colorStr.replace(/\s/g, ""); // remove all (including inner) whitespace

  let rgb = RGB_STRING_REGEXP.exec(colorStr);
  if (rgb && rgb.groups) {
    return color(rgb.groups);
  }

  let hex = HEX_STRING_REGEXP.exec(colorStr);
  if (hex) {
    return color(colorStr);
  }

  return default_;
}

function getGitModificationCounts(
  document: vscode.TextDocument
): number[] | undefined {
  const filePath = document.uri.fsPath;
  const fileDir = path.dirname(filePath);
  const lineCounts: number[] = new Array(document.lineCount).fill(0);

  let gitDiff = "";
  try {
    // Follow history even through renames
    gitDiff = execSync(`git log --follow -p -- "${filePath}"`, {
      cwd: fileDir,
      encoding: "utf-8",
      stdio: "pipe",
      maxBuffer: 1024 * 1024 * 10, // Increase buffer in case of long file history
    });
  } catch (err) {
    console.error("Failed to run git log -p:", err);
    return undefined;
  }

  // Match each diff hunk: @@ -a,b +c,d @@
  const hunkRegex =
    /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@([\s\S]*?)(?=^@@|\Z|^commit)/gm;

  let match;
  while ((match = hunkRegex.exec(gitDiff)) !== null) {
    const startLine = parseInt(match[1], 10);
    const hunkBody = match[3].split("\n");

    let lineNum = startLine;

    for (const line of hunkBody) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        // Added or modified line
        if (lineNum - 1 < lineCounts.length) {
          lineCounts[lineNum - 1] += 1;
        }
        lineNum++;
      } else if (!line.startsWith("-") && !line.startsWith("---")) {
        // Unchanged line, advance pointer
        lineNum++;
      }
    }
  }

  return lineCounts;
}

function updateVisibleHeatmaps() {
  vscode.window.visibleTextEditors.forEach((editor) => {
    updateHeatmapForEditor(editor);
  });
}

function updateHeatmapForEditor(editor: vscode.TextEditor) {
  // clear whatever was already there
  heatStyles.forEach((style) => editor.setDecorations(style, []));

  // decide whether heatmap needs to be redrawn
  if (!enabledForFiles.has(editor.document.uri)) {
    return;
  }

  // Create the buckets:
  //   const ranges: vscode.Range[][] = [];
  //   for (let i = 0; i < heatStyles.length; ++i) {
  //     ranges[i] = [];
  //   }
  const decorations: vscode.DecorationOptions[][] = Array.from(
    { length: heatStyles.length },
    () => []
  );

  // Bucket each line range by age:
  const document = editor.document;
  //const lineTimes = getGitTimestampsForLines(document);
  const lineCounts = getGitModificationCounts(document);
  //if (lineTimes === undefined || lineTimes.length === 0) {
  if (lineCounts === undefined || lineCounts.length === 0) {
    return;
  }

  //const minTime = lineTimes.reduce((a, b) => Math.min(a, b), lineTimes[0]);
  //const maxTime = lineTimes.reduce((a, b) => Math.max(a, b), lineTimes[0]);
  const minTime = lineCounts.reduce((a, b) => Math.min(a, b), lineCounts[0]);
  const maxTime = lineCounts.reduce((a, b) => Math.max(a, b), lineCounts[0]);
  const timeRange = maxTime - minTime;

  if (timeRange === 0) {
    return;
  }

  // Use logarithmic scaling for better color distribution
  //   const logMin = Math.log(minTime + 1);
  //   const logMax = Math.log(maxTime + 1);
  //   const logRange = logMax - logMin;

  //   if (logRange === 0) {
  //     return;
  //   }

  const timePerLevel = (timeRange + heatStyles.length - 1) / heatStyles.length;

  for (let i = 0; i < document.lineCount; ++i) {
    const line = document.lineAt(i);
    const range = new vscode.Selection(line.range.start, line.range.end);
    //const lineTime = lineTimes[i];
    const lineTime = lineCounts[i];

    if (lineTime === undefined) {
      continue;
    }

    // Logarithmic bucket calculation
    // const logValue = Math.log(lineTime + 1);
    // const bucket = Math.floor(
    //   ((logValue - logMin) / logRange) * (heatStyles.length - 1)
    // );

    const bucket = Math.floor((lineTime - minTime) / timePerLevel);

    //ranges[bucket].push(range);
    decorations[bucket].push({
      range: new vscode.Range(line.range.start, line.range.end),
      renderOptions: {
        before: {
          contentText: " ",
          backgroundColor: heatStyles[bucket] ? heatStyles[bucket] : undefined,
        },
        after: {
          contentText: ` (${lineCounts[i]})`,
          color: "gray",
          margin: "0 0 0 1em",
        },
      },
    });
  }

  // Apply the styles:
  for (let i = 0; i < heatStyles.length; ++i) {
    //editor.setDecorations(heatStyles[i], ranges[i]);
    editor.setDecorations(heatStyles[i], decorations[i]);
  }
}

function setHeatmapEnabled(enable: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  if (enable) {
    enabledForFiles.add(editor.document.uri);
  } else {
    enabledForFiles.delete(editor.document.uri);
  }

  updateVisibleHeatmaps();
}

function toggleHeatmap() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  if (enabledForFiles.has(editor.document.uri)) {
    enabledForFiles.delete(editor.document.uri);
  } else {
    enabledForFiles.add(editor.document.uri);
  }

  updateVisibleHeatmaps();
}

function buildDecorations() {
  const config = vscode.workspace.getConfiguration("heatmap");
  const heatLevels = config.get<number>("heatLevels") || DEFAULT_HEAT_LEVELS;
  const heatColor = colorFromString(
    config.get<string>("heatColour", ""),
    DEFAULT_HEAT_COLOUR
  );
  const showInRuler = config.get<boolean>("showInRuler");

  const defaultCoolColor = heatColor.alpha(0);
  const coolColor = colorFromString(
    config.get<string>("coolColour", ""),
    defaultCoolColor
  );

  if (heatLevels < 1) {
    vscode.window.showErrorMessage(
      "Heatmap: Invalid number of heat levels (must be >1)."
    );
    return;
  }

  // remove all decorations from all visible editors so we can rebuild the
  // decorator list from scratch
  vscode.window.visibleTextEditors.forEach((editor) => {
    heatStyles.forEach((style) => editor.setDecorations(style, []));
  });

  let heatPerLevel = heatLevels > 1 ? 1.0 / (heatLevels - 1) : 0;

  heatStyles.length = 0;
  for (let i = 0; i < heatLevels; ++i) {
    const colorString = coolColor.mix(heatColor, heatPerLevel * i).hexa();

    heatStyles.push(
      vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        backgroundColor: colorString,
        overviewRulerColor: showInRuler ? colorString : undefined,
      })
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  buildDecorations();

  vscode.workspace.onDidChangeConfiguration((ev) => {
    if (ev.affectsConfiguration("heatmap")) {
      buildDecorations();
      updateVisibleHeatmaps();
    }
  });

  let commands = [
    vscode.commands.registerCommand("heatmap.enable", () => {
      setHeatmapEnabled(true);
    }),
    vscode.commands.registerCommand("heatmap.disable", () => {
      setHeatmapEnabled(false);
    }),
    vscode.commands.registerCommand("heatmap.toggle", () => {
      toggleHeatmap();
    }),
  ];

  commands.forEach((cmd) => context.subscriptions.push(cmd));

  vscode.window.onDidChangeVisibleTextEditors(
    (_) => {
      updateVisibleHeatmaps();
    },
    null,
    context.subscriptions
  );
}

export function deactivate() {}
