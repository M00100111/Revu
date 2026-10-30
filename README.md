# Revu

A lightweight desktop editor built with Electron, React, TypeScript, and Monaco. It supports multiple projects and Git chunk review.

## Start

Requirements: Windows, Node.js 22.12+, and Git on `PATH`.

~~~powershell
npm install
npm run dev
~~~

The development command opens the Revu desktop window. Vite is used only for renderer hot reload.

- Build: `npm run build`
- Run the production build: `npm start`
- Build a portable Windows exe: `npm run dist`
- Tests: `npm test`

Use **Open Folder** to select a project with Electron's native Windows dialog. File access, Git, file watching, and diff operations run in the Electron main process through a restricted preload API.

## Editing and review

- Mixed and isolated modes affect editor tabs only.
- File, Review, and Settings sidebars are resizable. Their widths are synchronized by default and can be separated under Settings → Interaction.
- Review can show all projects or one selected project.
- The review base is the HEAD captured when a project opens. Staged and unstaged changes appear together.
- Accept keeps the draft and records the decision. Reject restores the chunk to its base content.
- Processed chunks remain visible and can be reversed with Undo.
- Save and Accept do not modify the Git index.
- If HEAD changes, Revu keeps the original base until the user refreshes it.

## External changes

Revu watches open projects and performs a three-way merge using the last synced content, the current draft, and the latest disk content. Non-conflicting edits merge automatically. A conflict preserves the draft and pauses save and review operations until the user completes the merge.

Saving checks the disk hash first. External sync resets text undo history while preserving valid review records.

## MVP limits

- UTF-8 text with BOM, LF, or CRLF is supported.
- Deleted, renamed, binary, mixed-line-ending, and unresolved Git-conflict files show status only.
- Drafts and review records last for the current app session only. Theme and sidebar preferences are stored locally.
- AI suggestions and agents are outside this version.
