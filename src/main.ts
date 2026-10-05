import {
	App,
	Modal,
	Notice,
	Plugin,
	Setting,
	TFile,
	TFolder,
} from "obsidian";

interface PhraseResult {
	phrase: string;
	count: number;
	files: number;
}

interface AnalyzerSettings {
	minOccurrences: number;
	minWords: number;
	maxWords: number;
	resultLimit: number;
}

const DEFAULT_SETTINGS: AnalyzerSettings = {
	minOccurrences: 3,
	minWords: 1,
	maxWords: 4,
	resultLimit: 100,
};

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"been",
	"but",
	"by",
	"can",
	"could",
	"did",
	"do",
	"does",
	"for",
	"from",
	"had",
	"has",
	"have",
	"he",
	"her",
	"here",
	"hers",
	"him",
	"his",
	"how",
	"i",
	"if",
	"in",
	"is",
	"it",
	"its",
	"me",
	"my",
	"no",
	"not",
	"of",
	"on",
	"or",
	"our",
	"ours",
	"she",
	"so",
	"than",
	"that",
	"the",
	"their",
	"theirs",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"those",
	"to",
	"too",
	"was",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"who",
	"will",
	"with",
	"would",
	"you",
	"your",
	"yours",
]);

export default class PhraseFrequencyPlugin extends Plugin {
	settings: AnalyzerSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "analyse-phrase-frequency",
			name: "Analyse phrase frequency",
			callback: () => {
				new PhraseAnalyzerModal(this.app, this).open();
			},
		});

		this.addRibbonIcon(
			"bar-chart-3",
			"Analyse phrase frequency",
			() => {
				new PhraseAnalyzerModal(this.app, this).open();
			}
		);

		this.addSettingTab(new PhraseFrequencySettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PhraseAnalyzerModal extends Modal {
	plugin: PhraseFrequencyPlugin;

	folderInput!: HTMLInputElement;
	minOccurrencesInput!: HTMLInputElement;
	minWordsInput!: HTMLInputElement;
	maxWordsInput!: HTMLInputElement;
	resultLimitInput!: HTMLInputElement;

	resultsContainer!: HTMLElement;
	statusContainer!: HTMLElement;

	constructor(app: App, plugin: PhraseFrequencyPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.empty();

		contentEl.createEl("h2", {
			text: "Phrase frequency analyser",
		});

		contentEl.createEl("p", {
			text: "Analyse Markdown files in a folder and find frequently occurring words and phrases.",
			cls: "phrase-analyser-description",
		});

		new Setting(contentEl)
			.setName("Folder")
			.setDesc(
				"Enter a vault folder path. Leave blank to analyse the entire vault."
			)
			.addText((text) => {
				this.folderInput = text.inputEl;

				text.setPlaceholder("e.g. RVC/Immunology");

				text.setValue("");
			});

		new Setting(contentEl)
			.setName("Minimum occurrences")
			.setDesc("Only show phrases occurring at least this many times.")
			.addText((text) => {
				this.minOccurrencesInput = text.inputEl;

				text.setValue(
					String(this.plugin.settings.minOccurrences)
				);

				text.inputEl.type = "number";
				text.inputEl.min = "1";
			});

		new Setting(contentEl)
			.setName("Minimum words")
			.setDesc("Smallest phrase size to analyse.")
			.addText((text) => {
				this.minWordsInput = text.inputEl;

				text.setValue(String(this.plugin.settings.minWords));

				text.inputEl.type = "number";
				text.inputEl.min = "1";
			});

		new Setting(contentEl)
			.setName("Maximum words")
			.setDesc("Largest phrase size to analyse.")
			.addText((text) => {
				this.maxWordsInput = text.inputEl;

				text.setValue(String(this.plugin.settings.maxWords));

				text.inputEl.type = "number";
				text.inputEl.min = "1";
			});

		new Setting(contentEl)
			.setName("Number of results")
			.setDesc("Maximum number of phrases to display.")
			.addText((text) => {
				this.resultLimitInput = text.inputEl;

				text.setValue(String(this.plugin.settings.resultLimit));

				text.inputEl.type = "number";
				text.inputEl.min = "1";
			});

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText("Analyse")
					.setCta()
					.onClick(async () => {
						await this.analyse();
					});
			});

		this.statusContainer = contentEl.createDiv({
			cls: "phrase-analyser-status",
		});

		this.resultsContainer = contentEl.createDiv({
			cls: "phrase-analyser-results",
		});
	}

	async analyse() {
		this.resultsContainer.empty();

		this.statusContainer.setText("Reading notes...");

		const folderPath = this.folderInput.value.trim();

		const minOccurrences = Math.max(
			1,
			parseInt(this.minOccurrencesInput.value) || 1
		);

		const minWords = Math.max(
			1,
			parseInt(this.minWordsInput.value) || 1
		);

		const maxWords = Math.max(
			minWords,
			parseInt(this.maxWordsInput.value) || minWords
		);

		const resultLimit = Math.max(
			1,
			parseInt(this.resultLimitInput.value) || 100
		);

		let files = this.plugin.app.vault.getMarkdownFiles();

		if (folderPath) {
			files = files.filter((file) =>
				file.path.startsWith(folderPath + "/")
			);

			const exactFolder = this.plugin.app.vault.getAbstractFileByPath(
				folderPath
			);

			if (!(exactFolder instanceof TFolder)) {
				this.statusContainer.setText(
					`Folder not found: ${folderPath}`
				);
				return;
			}
		}

		if (files.length === 0) {
			this.statusContainer.setText(
				"No Markdown files found."
			);
			return;
		}

		const wordCounts = new Map<string, number>();
		const phraseFiles = new Map<string, Set<string>>();

		let processedFiles = 0;

		for (const file of files) {
			const content = await this.plugin.app.vault.cachedRead(file);

			const words = extractWords(content);

			if (words.length === 0) {
				continue;
			}

			const phrases = generatePhrases(
				words,
				minWords,
				maxWords
			);

			for (const phrase of phrases) {
				wordCounts.set(
					phrase,
					(wordCounts.get(phrase) || 0) + 1
				);

				if (!phraseFiles.has(phrase)) {
					phraseFiles.set(
						phrase,
						new Set<string>()
					);
				}

				phraseFiles.get(phrase)!.add(file.path);
			}

			processedFiles++;

			if (processedFiles % 10 === 0) {
				this.statusContainer.setText(
					`Analysing... ${processedFiles}/${files.length} files`
				);

				await new Promise((resolve) =>
					setTimeout(resolve, 0)
				);
			}
		}

		const results: PhraseResult[] = [];

		for (const [phrase, count] of wordCounts.entries()) {
			if (count < minOccurrences) {
				continue;
			}

			results.push({
				phrase,
				count,
				files: phraseFiles.get(phrase)?.size || 0,
			});
		}

		results.sort((a, b) => {
			if (b.count !== a.count) {
				return b.count - a.count;
			}

			return a.phrase.localeCompare(b.phrase);
		});

		const limitedResults = results.slice(
			0,
			resultLimit
		);

		this.statusContainer.setText(
			`Analysed ${processedFiles} files. Found ${results.length} matching phrases.`
		);

		this.displayResults(limitedResults);
	}

	displayResults(results: PhraseResult[]) {
		this.resultsContainer.empty();

		if (results.length === 0) {
			this.resultsContainer.createEl("p", {
				text: "No phrases matched your settings.",
			});

			return;
		}

		const table = this.resultsContainer.createEl("table", {
			cls: "phrase-frequency-table",
		});

		const header = table.createEl("thead");
		const headerRow = header.createEl("tr");

		headerRow.createEl("th", {
			text: "Phrase",
		});

		headerRow.createEl("th", {
			text: "Occurrences",
		});

		headerRow.createEl("th", {
			text: "Files",
		});

		const body = table.createEl("tbody");

		for (const result of results) {
			const row = body.createEl("tr");

			row.createEl("td", {
				text: result.phrase,
			});

			row.createEl("td", {
				text: String(result.count),
			});

			row.createEl("td", {
				text: String(result.files),
			});
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

function extractWords(markdown: string): string[] {
	let text = markdown;

	// Remove YAML frontmatter.
	text = text.replace(
		/^---[\s\S]*?---/,
		" "
	);

	// Remove code blocks.
	text = text.replace(
		/```[\s\S]*?```/g,
		" "
	);

	// Remove inline code.
	text = text.replace(
		/`[^`]*`/g,
		" "
	);

	// Remove Obsidian links but keep their visible text.
	text = text.replace(
		/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
		"$2 $1"
	);

	// Remove Markdown links but keep link text.
	text = text.replace(
		/\[([^\]]+)\]\([^)]+\)/g,
		"$1"
	);

	// Remove headings.
	text = text.replace(
		/^#{1,6}\s+/gm,
		""
	);

	// Remove HTML.
	text = text.replace(
		/<[^>]*>/g,
		" "
	);

	// Lowercase.
	text = text.toLowerCase();

	// Keep letters, numbers and apostrophes.
	text = text.replace(
		/[^a-z0-9'\s-]/g,
		" "
	);

	// Split into words.
	const rawWords = text.split(/\s+/);

	return rawWords
		.map((word) => word.trim())
		.filter((word) => {
			if (!word) {
				return false;
			}

			if (word.length < 2) {
				return false;
			}

			if (STOP_WORDS.has(word)) {
				return false;
			}

			return true;
		});
}

function generatePhrases(
	words: string[],
	minWords: number,
	maxWords: number
): string[] {
	const phrases: string[] = [];

	for (
		let phraseLength = minWords;
		phraseLength <= maxWords;
		phraseLength++
	) {
		for (
			let i = 0;
			i <= words.length - phraseLength;
			i++
		) {
			const phraseWords = words.slice(
				i,
				i + phraseLength
			);

			// Don't allow a phrase to start or end with
			// a stop word.
			if (
				STOP_WORDS.has(phraseWords[0]) ||
				STOP_WORDS.has(
					phraseWords[phraseWords.length - 1]
				)
			) {
				continue;
			}

			const phrase = phraseWords.join(" ");

			phrases.push(phrase);
		}
	}

	return phrases;
}

class PhraseFrequencySettingTab extends PluginSettingTab {
	plugin: PhraseFrequencyPlugin;

	constructor(app: App, plugin: PhraseFrequencyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "Phrase Frequency",
		});

		new Setting(containerEl)
			.setName("Default minimum occurrences")
			.setDesc(
				"Default minimum number of times a phrase must occur."
			)
			.addText((text) =>
				text
					.setValue(
						String(
							this.plugin.settings
								.minOccurrences
						)
					)
					.onChange(async (value) => {
						this.plugin.settings.minOccurrences =
							Math.max(
								1,
								parseInt(value) || 1
							);

						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default minimum words")
			.addText((text) =>
				text
					.setValue(
						String(
							this.plugin.settings.minWords
						)
					)
					.onChange(async (value) => {
						this.plugin.settings.minWords =
							Math.max(
								1,
								parseInt(value) || 1
							);

						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default maximum words")
			.addText((text) =>
				text
					.setValue(
						String(
							this.plugin.settings.maxWords
						)
					)
					.onChange(async (value) => {
						this.plugin.settings.maxWords =
							Math.max(
								this.plugin.settings.minWords,
								parseInt(value) ||
									this.plugin.settings
										.minWords
							);

						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default result limit")
			.addText((text) =>
				text
					.setValue(
						String(
							this.plugin.settings
								.resultLimit
						)
					)
					.onChange(async (value) => {
						this.plugin.settings.resultLimit =
							Math.max(
								1,
								parseInt(value) || 100
							);

						await this.plugin.saveSettings();
					})
			);
	}
}