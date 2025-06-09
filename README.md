# VS Code Line History Tool

![Line History Tool](images/icon.png)

This extension provides tools for visualizing and understanding the history of your code at the line level in Visual Studio Code. It supports both **heatmap visualization** and **per-line modification counts** using Git (and experimental Perforce support).

## Features

- **Heatmap Visualization:**  
  See the relative age of each line in your file. The background color of every line reflects how recently it was changed—the brightest lines are the most recent.
- **Modification Count Mode:**  
  View how many times each line has been changed in Git. Useful for identifying "hot spots" in your codebase.
- **Toggle Modes:**  
  Switch between "relative age" and "absolute modification count" modes.
- **Per-line Details:**  
  Hover or view beside each line how many times it has changed (in absolute mode) or its age rank (in relative mode).
- **Command Palette Integration:**  
  Easily enable, disable, or toggle the visualization from the command palette.
- **Customizable Colors and Levels:**  
  Configure the number of heat levels and the color scheme to fit your preferences.

## Requirements

- Requires `git` in your `$PATH` for Git-based features.
- Experimental Perforce support (requires `p4` and workspace configuration).

## Installation

Install through the Visual Studio Code Marketplace:  
https://marketplace.visualstudio.com/items?itemName=chrisjdavies.heatmap

## Example

## Commands

This extension adds the following commands to the command palette:

- **Line History: On** — Enable the visualization for the current file.
- **Line History: Off** — Disable the visualization for the current file.
- **Line History: Toggle** — Toggle the visualization on/off.
- **Line History: Set Mode (Absolute)** — Show modification counts per line.
- **Line History: Set Mode (Relative)** — Show relative age per line.
- **Line History: Show VCS Type** — Show which version control system is detected for the current file.

## Configuration

| Property | Description | Type | Default value |
|---|---|---|---|
|`heatmap.heatLevels`|The number of different heat levels to visualize.|Integer|10|
|`heatmap.heatColour`|The color of the "hottest" heat level (most recent changes), as a list of numbers R, G, B, or a hex color code.|String|`200,0,0` or `#C80000`|
|`heatmap.coolColour`|The color of the "coolest" heat level (oldest changes), as a list of numbers R, G, B, or a hex color code.|String|Same as heatColour, but with 100% alpha|
|`heatmap.showInRuler`|Whether to show the heatmap in the overview ruler.|Boolean|true|
|`heatmap.mode`|Which mode to use: `"relative"` (age) or `"absolute"` (modification count).|String|`relative`|

## Use Cases

- **Code Auditing:**  
  Quickly identify which parts of your codebase are legacy or have changed recently.
- **Refactoring:**  
  Spot lines that have been changed frequently and may need attention.
- **Onboarding:**  
  Understand the history and "hot spots" of a new codebase at a glance.
