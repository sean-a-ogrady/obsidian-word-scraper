import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, addIcon, TFile } from 'obsidian';

interface WordScraperSettings {
	lastUpdated: string;
}

const DEFAULT_SETTINGS: WordScraperSettings = {
	lastUpdated: ''
}

export default class WordScraperPlugin extends Plugin {
	settings: WordScraperSettings;
	private wordFrequency: { [key: string]: number } = {};
	private dailyMdFile: TFile | null = null;
	private lastKnownDate: string = new Date().toISOString().slice(0, 10);
	private statusBar: HTMLElement;
	private updateScheduled: boolean = false;
	private fileInitialized: boolean = false;
	private currentFile: string = "";
	private lastContent: string = "";

	async onload() {
		await this.loadSettings();

		this.registerInterval(window.setInterval(this.checkDateAndReset.bind(this), 60 * 1000));

		this.registerEvent(
			this.app.workspace.on('editor-change', this.handleChange.bind(this))
		);

		const ribbonIconEl = this.addRibbonIcon('pencil', 'Word Scraper', async (evt: MouseEvent) => {
			await this.openDailyWordFile();
		});
		ribbonIconEl.addClass('word-scraper-ribbon');

		this.addCommand({
			id: 'open-daily-word-file',
			name: 'Open Daily Word File',
			callback: async () => {
				await this.openDailyWordFile();
			}
		});

		this.statusBar = this.addStatusBarItem();
		this.statusBar.setText(`0 unique words today`);

		this.addSettingTab(new SampleSettingTab(this.app, this));

	}

	onunload() {
		this.wordFrequency = {};
		this.dailyMdFile = null;
	}

	private async handleChange(change: Editor): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.editor === change) {
			const newContent = change.getValue();
			const activeFile = this.app.workspace.getActiveFile();
	
			if (activeFile && activeFile.path !== this.currentFile) {
				this.currentFile = activeFile.path;
				this.fileInitialized = false;
			}
	
			if (!this.fileInitialized) {
				this.lastContent = newContent;
				this.fileInitialized = true;
				return;
			}
	
			// Split the old and new content into words
			const oldWords = (this.lastContent.match(/\b\w+\b/g) || []) as string[];
			const newWords = (newContent.match(/\b\w+\b/g) || []) as string[];
	
			// Find added and removed words
			const addedWords = newWords.filter(word => !oldWords.includes(word));
			const removedWords = oldWords.filter(word => !newWords.includes(word));
	
			// Update word frequency for added content
			for (const word of addedWords) {
				if (this.wordFrequency[word]) {
					this.wordFrequency[word]++;
				} else {
					this.wordFrequency[word] = 1;
				}
			}
	
			// Update word frequency for removed content
			for (const word of removedWords) {
				if (this.wordFrequency[word]) {
					this.wordFrequency[word]--;
					if (this.wordFrequency[word] === 0) {
						delete this.wordFrequency[word];
					}
				}
			}
	
			// Update last known content
			this.lastContent = newContent;
	
			// Update status bar
			const totalWords = Object.keys(this.wordFrequency).length;
			this.statusBar.setText(`${totalWords} unique words today`);
	
			// Schedule an update for the daily MD file
			if (!this.updateScheduled) {
				this.updateScheduled = true;
				setTimeout(async () => {
					await this.updateDailyMdFile();
					this.updateScheduled = false;
				}, 1000);
			}
		}
	}
	



	private async updateDailyMdFile(): Promise<void> {
		try {
			const vault = this.app.vault;
			const today = new Date().toISOString().slice(0, 10);
			const fileName = `WordScraper-${today}.md`;

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
				...Object.entries(this.wordFrequency).map(([word, count]) => `${word}: ${count}`)
			].join('\n');

			await vault.modify(this.dailyMdFile, content);
		} catch (error) {
			console.error("An error occurred while updating the daily Markdown file:", error);
		}
	}

	private async checkDateAndReset(): Promise<void> {
		const currentDate = new Date().toISOString().slice(0, 10);
		if (currentDate !== this.lastKnownDate) {
			this.wordFrequency = {};
			this.lastKnownDate = currentDate;
			this.dailyMdFile = null;
			await this.updateDailyMdFile();
		}
	}

	private async openDailyWordFile(): Promise<void> {
		const vault = this.app.vault;
		const today = new Date().toISOString().slice(0, 10);
		const fileName = `WordCloud-${today}.md`;

		if (!this.dailyMdFile) {
			this.dailyMdFile = await vault.getAbstractFileByPath(fileName) as TFile;
		}

		if (!this.dailyMdFile) {
			this.dailyMdFile = await vault.create(fileName, '');
		}

		if (this.dailyMdFile) {
			this.app.workspace.getLeaf().openFile(this.dailyMdFile);
		} else {
			new Notice('Failed to open or create daily word file.');
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
