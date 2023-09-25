import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, addIcon, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

interface WordScraperSettings {
	lastUpdated: string;
}

const DEFAULT_SETTINGS: WordScraperSettings = {
	lastUpdated: ''
}

export default class WordScraperPlugin extends Plugin {
	settings: WordScraperSettings;
	private wordList: string[] = [];
	private dailyMdFile: TFile | null = null;
	private lastKnownDate: string = new Date().toISOString().slice(0, 10);
	private statusBar: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.registerInterval(window.setInterval(this.checkDateAndReset.bind(this), 60 * 1000));  // Check every minute

		this.registerCodeMirror((cm: CodeMirror.Editor) => {
			cm.on("change", this.handleChange.bind(this));
		});

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('pencil', 'Word Scraper', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Word Scraper Clicked!');
		});
		ribbonIconEl.addClass('word-scraper-ribbon');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBar = this.addStatusBarItem();
		this.statusBar.setText(`${this.wordList.length} words today`);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {
		this.wordList = [];
		this.dailyMdFile = null;
	}

	private async handleChange(cm: CodeMirror.Editor, change: any): Promise<void> {
		const newWords = change.text.join(" ").match(/\b\w+\b/g);
		if (newWords) {
			this.wordList.push(...newWords);
			this.statusBar.setText(`${this.wordList.length} words today`);
		}
		await this.updateDailyMdFile();
	}

	private async updateDailyMdFile(): Promise<void> {
		try {
			const vault = this.app.vault;
			const today = new Date().toISOString().slice(0, 10);
			const fileName = `WordCloud-${today}.md`;

			if (!this.dailyMdFile) {
				this.dailyMdFile = await vault.getAbstractFileByPath(fileName) as TFile;
			}

			if (!this.dailyMdFile) {
				this.dailyMdFile = await vault.create(fileName, '');
			}

			const content = [
				'```wordcloud',
				'source: file',
				'```',
				'',
				...this.wordList
			].join('\n');

			await vault.modify(this.dailyMdFile, content);
		} catch (error) {
			console.error("An error occurred while updating the daily Markdown file:", error);
		}
	}

	private async checkDateAndReset(): Promise<void> {
		const currentDate = new Date().toISOString().slice(0, 10);
		if (currentDate !== this.lastKnownDate) {
			this.wordList = [];
			this.lastKnownDate = currentDate;
			this.dailyMdFile = null;  // Reset the daily file as well
			await this.updateDailyMdFile();  // Create a new file for the new day
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: WordScraperPlugin;

	constructor(app: App, plugin: WordScraperPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.lastUpdated)
				.onChange(async (value) => {
					this.plugin.settings.lastUpdated = value;
					await this.plugin.saveSettings();
				}));
	}
}
