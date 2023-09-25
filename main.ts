import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Interface for plugin settings
interface WordScraperSettings {
	lastUpdated: string;
}

// Default settings
const DEFAULT_SETTINGS: WordScraperSettings = {
	lastUpdated: ''
}

// Main plugin class
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

	// Plugin initialization
	async onload() {
		await this.loadSettings();

		// Check for date change every minute
		this.registerInterval(window.setInterval(this.checkDateAndReset.bind(this), 60 * 1000));

		// Register editor change event
		this.registerEvent(
			this.app.workspace.on('editor-change', this.handleChange.bind(this))
		);

		// Add status bar item
		this.statusBar = this.addStatusBarItem();
		this.statusBar.setText(`0 unique words today`);

		// Add settings tab
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	// Cleanup when plugin is disabled
	onunload() {
		this.wordFrequency = {};
		this.dailyMdFile = null;
	}

	// Handle editor changes
	private async handleChange(change: Editor): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.editor === change) {
			const newContent = change.getValue();
			const activeFile = this.app.workspace.getActiveFile();

			// Check if the file has changed
			if (activeFile && activeFile.path !== this.currentFile) {
				this.currentFile = activeFile.path;
				this.fileInitialized = false;
			}

			// Initialize lastContent for the new file
			if (!this.fileInitialized) {
				this.lastContent = newContent;
				this.fileInitialized = true;
				return;
			}

			// Calculate added and removed content
			const addedContent = newContent.replace(this.lastContent, "").trim();
			const removedContent = this.lastContent.replace(newContent, "").trim();

			// Update word frequency for added content
			const addedWords = addedContent.match(/\b\w+\b/g) || [];
			for (const word of addedWords) {
				this.wordFrequency[word] = (this.wordFrequency[word] || 0) + 1;
			}

			// Update word frequency for removed content
			const removedWords = removedContent.match(/\b\w+\b/g) || [];
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

			// Schedule update for the daily Markdown file
			if (!this.updateScheduled) {
				this.updateScheduled = true;
				setTimeout(async () => {
					await this.updateDailyMdFile();
					this.updateScheduled = false;
				}, 10000);  // 10 seconds for testing
			}
		}
	}

	// Update the daily Markdown file
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
				...Object.entries(this.wordFrequency).map(([word, count]) => `${word}: ${count}`)
			].join('\n');

			await vault.modify(this.dailyMdFile, content);
		} catch (error) {
			console.error("An error occurred while updating the daily Markdown file:", error);
		}
	}

	// Check for date change and reset word frequency
	private async checkDateAndReset(): Promise<void> {
		const currentDate = new Date().toISOString().slice(0, 10);
		if (currentDate !== this.lastKnownDate) {
			this.wordFrequency = {};
			this.lastKnownDate = currentDate;
			this.dailyMdFile = null;
			await this.updateDailyMdFile();
		}
	}

	// Load plugin settings
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// Save plugin settings
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Settings tab
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
