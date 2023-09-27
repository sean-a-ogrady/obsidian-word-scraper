// Import Obsidian API and types
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, addIcon, TFile } from 'obsidian';

// Define the settings interface
interface WordScraperSettings {
	lastUpdated: string;
	folderPath: string;
	excludedFolders: string;
}

// Define an interface to hold the plugin's state
interface WordScraperState {
    wordFrequency: { [key: string]: number };
    lastKnownDate: string;
    currentFile: string;
    lastContent: string;
}

// Default settings
const DEFAULT_SETTINGS: WordScraperSettings = {
	lastUpdated: '',
	folderPath: '/', // Default at root folder
	excludedFolders: ''
}

// Main plugin class
export default class WordScraperPlugin extends Plugin {
	settings: WordScraperSettings;
	state: WordScraperState;

	// Object to hold the frequency of each word
	private wordFrequency: { [key: string]: number } = {};

	// File where daily words will be saved
	private dailyMdFile: TFile | null = null;

	// Last known date to check for daily reset
	private lastKnownDate: string = new Date().toISOString().slice(0, 10);

	// Status bar element
	private statusBar: HTMLElement;

	// Flag to schedule updates
	private updateScheduled: boolean = false;

	// Flags to handle file initialization and content
	private fileInitialized: boolean = false;
	private currentFile: string = "";
	private lastContent: string = "";

	// Load settings and initialize the plugin
	async onload() {
		await this.loadSettings();

		// Load the saved state from disk
        this.state = await this.loadData() || {
            wordFrequency: {},
            lastKnownDate: new Date().toISOString().slice(0, 10),
            currentFile: "",
            lastContent: ""
        };

		// Register a timer to reset daily word count
		this.registerInterval(window.setInterval(this.checkDateAndReset.bind(this), 60 * 1000));

		// Register an event to listen for editor changes
		this.registerEvent(
			this.app.workspace.on('editor-change', this.handleChange.bind(this))
		);

		// Add a ribbon icon to open the daily word file
		const ribbonIconEl = this.addRibbonIcon('pencil', 'Word Scraper', async (evt: MouseEvent) => {
			await this.openDailyWordFile();
		});
		ribbonIconEl.addClass('word-scraper-ribbon');

		// Add a command to open the daily word file
		this.addCommand({
			id: 'open-daily-word-file',
			name: 'Open Daily Word File',
			callback: async () => {
				await this.openDailyWordFile();
			}
		});

		// Add a status bar item to show the number of unique words
		this.statusBar = this.addStatusBarItem();
		this.statusBar.setText(`0 unique words today`);

		// Add a settings tab
		this.addSettingTab(new WordScraperSettingTab(this.app, this));
	}

	// Cleanup when the plugin is unloaded
	onunload() {
		this.wordFrequency = {};
		this.dailyMdFile = null;
	}

	// Handle changes in the editor
	private async handleChange(change: Editor): Promise<void> {
		// Get the active markdown view
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

		// Check if the change is in the active view
		if (activeView && activeView.editor === change) {
			// Get the new content of the editor
			const newContent = change.getValue();

			// Get the active file
			const activeFile = this.app.workspace.getActiveFile();

			// Check if the file is in an excluded folder
			const excludedFolders = this.settings.excludedFolders.split('\n').filter(Boolean); // Filter out empty strings
			if (activeFile && excludedFolders.some(folder => activeFile.path.startsWith(folder))) {
				return; // Skip this file
			}

			// Check if the file has changed
			if (activeFile && activeFile.path !== this.currentFile) {
				this.currentFile = activeFile.path;
				this.fileInitialized = false;
			}

			// Initialize the last content if the file is new
			if (!this.fileInitialized) {
				this.lastContent = newContent;
				this.fileInitialized = true;
				return;
			}

			// Split the old and new content into words
			const oldWords = (this.lastContent.match(/\b\w+\b/g) || []) as string[];
			const newWords = (newContent.match(/\b\w+\b/g) || []) as string[];

			// Create frequency maps for old and new words
			const oldWordFrequency: { [key: string]: number } = {};
			const newWordFrequency: { [key: string]: number } = {};
			oldWords.forEach(word => oldWordFrequency[word] = (oldWordFrequency[word] || 0) + 1);
			newWords.forEach(word => newWordFrequency[word] = (newWordFrequency[word] || 0) + 1);

			// Update global word frequency
			for (const word of new Set([...Object.keys(oldWordFrequency), ...Object.keys(newWordFrequency)])) {
				const oldCount = oldWordFrequency[word] || 0;
				const newCount = newWordFrequency[word] || 0;
				const delta = newCount - oldCount;

				if (this.wordFrequency[word]) {
					this.wordFrequency[word] += delta;
				} else {
					this.wordFrequency[word] = delta;
				}

				if (this.wordFrequency[word] <= 0) {
					delete this.wordFrequency[word];
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

			// Update the state
			this.state.wordFrequency = this.wordFrequency;
			this.state.currentFile = this.currentFile;
			this.state.lastContent = this.lastContent;
	
			// Save the state to disk
			await this.saveData(this.state);
		}
	}

	// Update the daily Markdown file with the word frequencies
	private async updateDailyMdFile(): Promise<void> {
		try {
			// Get or create the daily file
			const vault = this.app.vault;
			const today = new Date().toISOString().slice(0, 10);
			const fileName = `${this.settings.folderPath}/WordScraper-${today}.md`;

			if (!this.dailyMdFile) {
				this.dailyMdFile = await vault.getAbstractFileByPath(fileName) as TFile;
			}

			if (!this.dailyMdFile) {
				this.dailyMdFile = await vault.create(fileName, '');
			}

			// Generate the content with additional checks
			const content = [
				'```wordcloud',
				'source: file',
				'```',
				'',
				...Object.entries(this.wordFrequency)
					.filter(([word, count]) =>
						Object.prototype.hasOwnProperty.call(this.wordFrequency, word) &&
						typeof count === 'number' &&
						count > 0
					)
					.map(([word, count]) => `${word}: ${count}`)
			].join('\n');

			// Update the daily file
			await vault.modify(this.dailyMdFile, content);
		} catch (error) {
			console.error("An error occurred while updating the daily Markdown file:", error);
		}
	}

	// Reset the word frequency and daily file at midnight
    private async checkDateAndReset(): Promise<void> {
        const currentDate = new Date().toISOString().slice(0, 10);
        if (currentDate !== this.state.lastKnownDate) {
            // Reset the state variables
            this.state.wordFrequency = {};
            this.state.lastKnownDate = currentDate;

            // Save the reset state to disk
            await this.saveData(this.state);

            this.dailyMdFile = null;
            await this.updateDailyMdFile();
        }
    }

	// Open the daily word file
	private async openDailyWordFile(): Promise<void> {
		const vault = this.app.vault;
		const today = new Date().toISOString().slice(0, 10);
		const fileName = `${this.settings.folderPath}/WordScraper-${today}.md`;

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

	// Load settings from disk
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// Save settings to disk
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Settings tab in the Obsidian settings panel
class WordScraperSettingTab extends PluginSettingTab {
	plugin: WordScraperPlugin;

	constructor(app: App, plugin: WordScraperPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('WordScraper Folder')
			.setDesc(`Specify the folder where WordScraper files will be saved.`)
			.addText(text => text
				.setPlaceholder('Enter folder path')
				.setValue(this.plugin.settings.folderPath)
				.onChange(async (value) => {
					this.plugin.settings.folderPath = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Excluded Folders')
			.setDesc('Enter folder names to exclude scraping, separated by new lines.')
			.addTextArea(text => text
				.setPlaceholder('Enter folder names')
				.setValue(this.plugin.settings.excludedFolders)
				.onChange(async (value) => {
					this.plugin.settings.excludedFolders = value;
					await this.plugin.saveSettings();
				}));

	}
}
