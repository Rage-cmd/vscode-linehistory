import { execSync } from "child_process";
import path = require("path");
import color = require("color");
import * as vscode from "vscode";
import * as fs from "fs";

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

/**
 * Detects the version control system (VCS) type for a given file path.
 * Currently supports Git and Perforce.
 * @param filePath The file path to check.
 * @returns "git" if the file is in a Git repository, "perforce" if in a Perforce workspace, or undefined if neither.
 */
function detectVcsType(filePath: string): "git" | "perforce" | undefined {
  let dir = path.dirname(filePath);

  // Check for .git directory
  let current = dir;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return "git";
    }
    if (fs.existsSync(path.join(current, ".p4config"))) {
      return "perforce";
    }
    current = path.dirname(current);
  }

  // Check environment variable for Perforce
  if (process.env.P4CONFIG) {
    return "perforce";
  }

  return undefined;
}

/**
 * Represents information about a line in the document, including its timestamp,
 * age score (1-10), and the display number to show beside the line.
 */
interface LineInfo {
  timestamp: number | undefined;
  ageScore: number; // 1-10
  displayNumber: number; // The actual number to show beside the line
}

/**
 * Retrieves the normalized age score (1-10) and a display number for each line.
 * 1 indicates an older, less changed line.
 * 10 indicates a newer, more recently changed line (or uncommitted new line).
 * @param document The VS Code TextDocument to analyze.
 * @returns An array of LineInfo objects, or undefined if Git blame fails.
 */
function getGitLineInfo(document: vscode.TextDocument): undefined | LineInfo[] {
  const filePath = document.uri.fsPath;
  const fileDir = path.dirname(filePath);
  const escapedFilePath = filePath.replace(/(["'$`\\])/g, "\\$1");
  const lineInfos: (LineInfo | undefined)[] = new Array(
    document.lineCount
  ).fill(undefined);
  const hashCache: { [key: string]: number } = {}; // Stores commit hash -> timestamp

  try {
    const blameOutput = execSync(`git blame -p "${escapedFilePath}"`, {
      cwd: fileDir,
    }).toString();
    const lines = blameOutput.split("\n");
    let currentHash: string = "0000000000000000000000000000000000000000";
    const rawLineTimestamps: (number | undefined)[] = new Array(
      document.lineCount
    ).fill(undefined);
    // `commitLineNumbers` is not used in the new age calculation, so it can be removed if not needed elsewhere.
    // let commitLineNumbers: { [hash: string]: number[] } = {}; // To track which lines a commit touches

    // Pass 1: Collect hash -> timestamps. This populates hashCache.
    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i];
      const match = line.match(/^([0-9a-f]{40}) \d+ (\d+)(?: (\d+))?/);

      if (match) {
        currentHash = match[1];
        // The finalLineNumber is not needed in this pass for hashCache population
      } else if (line.startsWith("committer-time ")) {
        hashCache[currentHash] = parseInt(line.split(" ")[1]);
      }
    }
    // console.log("hashCache", hashCache); // For debugging

    // Get unique timestamps and sort them to determine rank
    const uniqueTimestamps = Array.from(new Set(Object.values(hashCache))).sort(
      (a, b) => a - b
    );
    const timestampToRank = new Map<number, number>();
    uniqueTimestamps.forEach((ts, index) => {
      timestampToRank.set(ts, index + 1); // Rank starts from 1
    });

    // Pass 2: Map lines to their raw timestamps using the populated hashCache
    // No need to find min/max time explicitly anymore as we use rank.
    // No need to track latestCommitHash/Time as emphasis is now solely on rank.
    currentHash = "0000000000000000000000000000000000000000"; // Reset currentHash for parsing lines
    for (let i = 0; i < lines.length; ++i) {
      const line = lines[i];
      const match = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);

      if (match) {
        currentHash = match[1];
        const finalLineNumber = parseInt(match[2]);

        const timestamp = hashCache[currentHash];
        if (timestamp !== undefined) {
          rawLineTimestamps[finalLineNumber - 1] = timestamp;
        }
      }
    }
    // console.log("rawLineTimestamps", rawLineTimestamps); // For debugging

    // Pass 3: Calculate age score and display number for each line based on rank
    for (let i = 0; i < document.lineCount; ++i) {
      const timestamp = rawLineTimestamps[i];
      let ageScore: number;
      let displayNumber: number;

      if (timestamp === undefined) {
        // Lines with no blame info (e.g., very new, uncommitted changes).
        // Assign them the highest possible rank (latest).
        ageScore =
          uniqueTimestamps.length > 0 ? uniqueTimestamps.length + 1 : 1; // +1 to be newer than all blamed lines
        displayNumber = ageScore; // Display the same as ageScore
      } else {
        // Get the rank from the sorted unique timestamps
        ageScore = timestampToRank.get(timestamp) || 1; // Default to 1 if for some reason not found (shouldn't happen)
        displayNumber = ageScore; // Display the same as ageScore
      }
      lineInfos[i] = { timestamp, ageScore, displayNumber };
    }
  } catch (e) {
    console.error("Git blame failed:", e); // Log the actual error for debugging
    return undefined;
  }

  return lineInfos.filter((info): info is LineInfo => info !== undefined);
}

/**
 * Retrieves the number of times each line in a file has been modified in Git.
 * This is done by running `git log -L` for each line.
 * @param document The VS Code TextDocument to analyze.
 * @returns An array of counts for each line, or undefined if Git log fails.
 */
function getGitModificationCounts(
  document: vscode.TextDocument
): number[] | undefined {
  const filePath = document.uri.fsPath;
  const fileDir = path.dirname(filePath);
  const lineCounts: number[] = new Array(document.lineCount).fill(0);

  for (let i = 1; i <= document.lineCount; i++) {
    const command = `git log -L ${i},${i}:${filePath} --pretty=format:"%H"`;
    try {
      const output = execSync(command, {
        cwd: fileDir,
        encoding: "utf-8",
        stdio: "pipe",
      });
      const count = output.trim().split("\n").filter(Boolean).length;
      lineCounts[i - 1] = count;
    } catch (err) {
      // Likely means this line has no git history (e.g. new or deleted)
      lineCounts[i - 1] = 0;
    }
  }

  return lineCounts;
}

/**
 * Updates the heatmap decorations for all visible text editors based on the current mode.
 * This function checks the mode (absolute or relative) and updates each editor accordingly.
 */
function updateVisibleHeatmaps() {
  vscode.window.visibleTextEditors.forEach((editor) => {
    const config = vscode.workspace.getConfiguration("heatmap");
    const mode = config.get<string>("mode", "absolute"); // "absolute" or "relative"

    if (mode === "relative") {
      updateHeatmapForRelativeMode(editor);
    } else if (mode === "absolute") {
      updateHeatmapForAbsoluteMode(editor);
    }
  });
}

/**
 * Updates the heatmap for the currently active editor in "relative" mode.
 * This mode shows the age of each line based on its last modification time.
 * @param editor The active text editor to update.
 */
function updateHeatmapForRelativeMode(editor: vscode.TextEditor) {
  // Clear any existing decorations to avoid overlap or stale highlights
  heatStyles.forEach((style) => editor.setDecorations(style, []));

  // Check if heatmap functionality is enabled for this file
  if (!enabledForFiles.has(editor.document.uri)) {
    return;
  }

  // Prepare buckets for each of the 10 age levels (1-10)
  const ranges: vscode.Range[][] = [];
  const decorationOptionsMap: Map<number, vscode.DecorationOptions[]> =
    new Map(); // Map bucket index to options
  const numAgeLevels = 10;

  for (let i = 0; i < numAgeLevels; ++i) {
    ranges[i] = [];
    decorationOptionsMap.set(i, []);
  }

  // Detect VCS type for the current file
  const vcsType = detectVcsType(editor.document.uri.fsPath);
  if (vcsType == "git") {
  } else if (vcsType == "perforce") {
  } else {
    vscode.window.showErrorMessage(
      "Heatmap: Unsupported version control system. Only Git and Perforce are supported."
    );
    return;
  }

  // Get the calculated age scores and display numbers for each line
  const document = editor.document;
  const lineInfos = getGitLineInfo(document); // Call the new function

  // If we couldn't get age data, stop here
  if (lineInfos === undefined || lineInfos.length === 0) {
    return;
  }

  // Iterate through each line, get its age score, and prepare decoration options
  for (let i = 0; i < document.lineCount; ++i) {
    const line = document.lineAt(i);
    const range = new vscode.Selection(line.range.start, line.range.end);
    const info = lineInfos[i];

    if (info === undefined) {
      continue;
    }

    // Map the age score (1-10) to a bucket index (0-9) for coloring
    const bucketIndex = info.ageScore - 1;

    if (bucketIndex >= 0 && bucketIndex < numAgeLevels) {
      // Add the range for the background color
      ranges[bucketIndex].push(range);

      // Create a decoration option for the line number text
      decorationOptionsMap.get(bucketIndex)?.push({
        range: line.range,
        renderOptions: {
          after: {
            // The 'contentText' is the number that appears
            // Pad with a space if it's a single digit for alignment
            contentText: `${info.displayNumber < 10 ? " " : ""}(${
              info.displayNumber
            })`,
            // You can also adjust color/background specific to this decoration option
            // This will override the general 'before' style defined in heatStyles if specified
          },
        },
      });
    }
  }

  // Apply the decorations for each age level
  for (let i = 0; i < numAgeLevels; ++i) {
    const style = heatStyles[i];
    const currentRanges = ranges[i];
    const currentOptions = decorationOptionsMap.get(i) || [];

    // Combine ranges and options into a single setDecorations call for this style
    // This is less efficient than applying per line if options differ greatly,
    // but it's simpler if only contentText changes per line.
    // A more robust way might be to iterate line-by-line and create one decoration for each line.

    // If you define `before` in `heatStyles` itself,
    // then `setDecorations` with just `ranges` will work for background.
    // To vary the `contentText` per line, you need to pass an array of `DecorationOptions`.
    // The most direct way to ensure per-line contentText is:
    // editor.setDecorations(style, currentOptions); // Where currentOptions contains ranges and contentText

    // Let's adjust to pass options for each line where contentText is specific
    // We'll filter `currentOptions` to ensure each has a valid range.
    editor.setDecorations(
      style,
      currentOptions.filter((option) => option.range)
    );
  }
}

/**
 * Updates the heatmap for the currently active editor in "absolute" mode.
 * This mode shows the number of times each line has been modified in the VCS.
 * @param editor The active text editor to update.
 */
function updateHeatmapForAbsoluteMode(editor: vscode.TextEditor) {
  // Clear any existing decorations to avoid overlap or stale highlights
  heatStyles.forEach((style) => editor.setDecorations(style, []));

  // Check if heatmap functionality is enabled for this file
  if (!enabledForFiles.has(editor.document.uri)) {
    return;
  }

  const document = editor.document;

  // Detect VCS type for the current file
  const vcsType = detectVcsType(document.uri.fsPath);
  if (vcsType == "git") {
  } else if (vcsType == "perforce") {
  } else {
    vscode.window.showErrorMessage(
      "Heatmap: Unsupported version control system. Only Git and Perforce are supported."
    );
    return;
  }

  // Create the buckets:
  const decorations: vscode.DecorationOptions[][] = Array.from(
    { length: heatStyles.length },
    () => []
  );

  const lineCounts = getGitModificationCounts(document);
  if (lineCounts === undefined || lineCounts.length === 0) {
    return;
  }

  const minTime = lineCounts.reduce((a, b) => Math.min(a, b), lineCounts[0]);
  const maxTime = lineCounts.reduce((a, b) => Math.max(a, b), lineCounts[0]);
  const countRange = maxTime - minTime;

  if (countRange === 0) {
    return;
  }

  // Use logarithmic scaling for better color distribution
  const logMin = Math.log(minTime + 1);
  const logMax = Math.log(maxTime + 1);
  const logRange = logMax - logMin;

  if (logRange === 0) {
    return;
  }

  for (let i = 0; i < document.lineCount; ++i) {
    const line = document.lineAt(i);
    const lineCount = lineCounts[i];

    if (lineCount === undefined) {
      continue;
    }

    // Logarithmic bucket calculation
    const logValue = Math.log(lineCount + 1);
    const bucket = Math.floor(
      ((logValue - logMin) / logRange) * (heatStyles.length - 1)
    );

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
    editor.setDecorations(heatStyles[i], decorations[i]);
  }
}

/**
 * Enables or disables the heatmap for the currently active editor.
 * @param enable If true, enables the heatmap; otherwise disables it.
 */
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

/**
 * Toggles the heatmap on or off for the currently active editor.
 */
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

/**
 * Shows the VCS type for the currently active editor.
 * If no editor is active, it shows an information message.
 */
function showVcsTypeForActiveEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor.");
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const vcsType = detectVcsType(filePath);
  vscode.window.showInformationMessage(`VCS Type: ${vcsType ?? "none"}`);
}

/**
 * Sets the heatmap mode to "absolute"
 */
function setModeAbsolute() {
  vscode.workspace.getConfiguration("heatmap").update("mode", "absolute", true);
  vscode.window.showInformationMessage("Heatmap mode set to Absolute.");
  updateVisibleHeatmaps();
}

/**
 * Sets the heatmap mode to "relative"
 */
function setModeRelative() {
  vscode.workspace.getConfiguration("heatmap").update("mode", "relative", true);
  vscode.window.showInformationMessage("Heatmap mode set to Relative.");
  updateVisibleHeatmaps();
}

/**
 * Shows the current heatmap mode in an information message.
 */
function showCurrentMode() {
  const config = vscode.workspace.getConfiguration("heatmap");
  const mode = config.get<string>("mode", "absolute");
  vscode.window.showInformationMessage(`Current Heatmap Mode: ${mode}`);
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
    vscode.commands.registerCommand("heatmap.showVcsType", () => {
      showVcsTypeForActiveEditor();
    }),
    vscode.commands.registerCommand("heatmap.setModeAbsolute", () => {
      setModeAbsolute();
    }),
    vscode.commands.registerCommand("heatmap.setModeRelative", () => {
      setModeRelative();
    }),
    vscode.commands.registerCommand("heatmap.showCurrentMode", () => {
      showCurrentMode();
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
