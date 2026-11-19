import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// DeepSeek Harness cuts a skill description at 500 characters in the model prompt.
const MAX_DESCRIPTION_CHARS = 500;

function foldedDescription(markdown, file) {
	const lines = markdown.split(/\r?\n/);
	if (lines[0] !== "---") throw new Error(`${file}: missing frontmatter`);
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i] === "---") break;
		const match = lines[i].match(/^description:\s*(.*)$/);
		if (!match) continue;
		const inline = match[1].trim();
		if (inline && !["|-","|",">-","",">"].includes(inline)) {
			return inline.replace(/^['"]|['"]$/g, "");
		}
		const parts = [];
		for (let j = i + 1; j < lines.length; j += 1) {
			if (lines[j] === "---" || /^[A-Za-z0-9_]+:/.test(lines[j])) break;
			parts.push(lines[j].trim());
		}
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}
	throw new Error(`${file}: no description`);
}

test("every skill description stays under DeepSeek's 500-character limit", () => {
	const skills = readdirSync("skills", { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	assert.ok(skills.includes("literature-manager"));
	const lengths = {};
	for (const skill of skills) {
		const file = join("skills", skill, "SKILL.md");
		const description = foldedDescription(readFileSync(file, "utf8"), file);
		lengths[skill] = description.length;
		assert.ok(
			description.length > 0 && description.length < MAX_DESCRIPTION_CHARS,
			`${skill} description is ${description.length} characters; limit is ${MAX_DESCRIPTION_CHARS - 1}`,
		);
		assert.match(description, /Use /, `${skill} description dropped its trigger clause`);
	}
	assert.ok(lengths["literature-manager"] < 500);
	assert.ok(lengths["ai4s-setup"] < 460, "ai4s-setup should keep a margin under the limit");
});
