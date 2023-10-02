// Import Obsidian API and types
import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';

// Had to allow synthetic imports in tsconfig
import Sentiment from 'sentiment';


// Define the settings interface
interface WordScraperSettings {
	lastUpdated: string;
	folderPath: string;
	excludedFolders: string;
	updateFrequency: number;
	stopwords: string;
	enableJsonExport: boolean;
	jsonExportPath: string;
	enableAutomaticJsonExport: boolean;
}

// Define an interface to hold the plugin's state
interface WordScraperState {
	wordFrequency: { [key: string]: number };
	lastKnownDate: string;
	currentFile: string;
	lastContent: string;
	settings: WordScraperSettings;
}

// Default settings
const DEFAULT_SETTINGS: WordScraperSettings = {
	lastUpdated: '',
	folderPath: '', // Default at root folder
	excludedFolders: '',
	updateFrequency: 10000,
	stopwords: '',
	enableJsonExport: false,
	jsonExportPath: '',
	enableAutomaticJsonExport: false
}

// Bug fix for faulty date interpretation
function getLocalDate() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Main plugin class
export default class WordScraperPlugin extends Plugin {
	settings: WordScraperSettings;
	state: WordScraperState;
	private sentiment: Sentiment;

	// Object to hold the frequency of each word
	private wordFrequency: { [key: string]: number } = {};

	// File where daily words will be saved
	private dailyMdFile: TFile | null = null;

	// Last known date to check for daily reset
	private lastKnownDate: string = getLocalDate();

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
		console.log("WordScaper loading...");
		await this.loadSettings();
		const savedState = await this.loadOrInitializeState();
		this.sentiment = new Sentiment();
		//console.log("Loaded settings:", this.settings);
		//console.log("Loaded state:", savedState);
		if (savedState) {
			this.state = savedState;
			this.settings = savedState.settings ?? DEFAULT_SETTINGS;
			this.wordFrequency = Object.fromEntries(
				Object.entries(this.state.wordFrequency ?? {}).map(([key, value]) => [key.toLowerCase(), value])
			);
			this.wordFrequency = this.state.wordFrequency ?? {};
			this.lastKnownDate = this.state.lastKnownDate;
			this.currentFile = this.state.currentFile;
			this.lastContent = this.state.lastContent;
		} else {
			this.state = {
				wordFrequency: {},
				lastKnownDate: getLocalDate(),
				currentFile: "",
				lastContent: "",
				settings: this.settings
			};
		}

		// Register an event to listen for editor changes
		this.registerEvent(
			this.app.workspace.on('editor-change', this.handleChange.bind(this))
		);

		// Add a ribbon icon to open the daily word file
		const ribbonIconEl = this.addRibbonIcon('pencil', 'WordScraper', async (evt: MouseEvent) => {
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

		// Add a command to export current WordScraper file to JSON
		this.addCommand({
			id: 'export-word-frequency-to-json',
			name: 'Export Word Frequency to JSON',
			callback: async () => {
				await this.exportToJson();
			}
		});

		// Add a command to reset the file and state manually
		this.addCommand({
			id: 'reset-daily-md-file-and-state',
			name: 'Reset Daily MD File and State',
			callback: async () => {
				await this.resetDailyMdFileAndState();
			}
		});

		// Listen for file deletion events
		this.registerEvent(
			this.app.vault.on('delete', async (file: TFile) => {
				if (file.path === this.currentFile) {
					this.fileInitialized = false;
				}
			})
		);

		// Add a status bar item to show the number of unique words
		//this.statusBar = this.addStatusBarItem();
		//this.statusBar.setText(`0 unique words today`);

		// Add a settings tab
		this.addSettingTab(new WordScraperSettingTab(this.app, this));
	}

	// Cleanup when the plugin is unloaded
	async onunload() {
		// Save the current state to disk before unloading
		await this.saveData(this.state);
	}

	private async loadOrInitializeState(): Promise<WordScraperState> {
		const savedState = await this.loadData();
		if (savedState) {
			this.state = savedState;
			this.settings = savedState.settings ?? DEFAULT_SETTINGS;
			return savedState;
		} else {
			await this.resetState();
			return this.state;
		}
	}

	// Handle changes in the editor
	private async handleChange(change: Editor): Promise<void> {
		//console.log("Handling editor change...");
		// Get the active markdown view
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

		// Check if the change is in the active view
		if (activeView && activeView.editor === change) {
			// Get the new content of the editor
			const newContent = change.getValue();

			// Get the active file
			const activeFile = this.app.workspace.getActiveFile();

			// Reset fileInitialized flag if the file is deleted or cleared
			if (!activeFile || newContent === '') {
				this.fileInitialized = false;
				return;
			}

			// Check if the file is in an excluded folder
			const excludedFolders = this.settings.excludedFolders.split('\n').filter(Boolean); // Filter out empty strings
			if (activeFile && excludedFolders.some(folder => activeFile.path.startsWith(folder))) {
				return; // Skip this file
			}

			// Check if the file has changed
			if (activeFile && activeFile.path !== this.currentFile) {
				//console.log("File changed. Initializing...");
				this.currentFile = activeFile.path;
				this.fileInitialized = false;
			}

			// Initialize the last content if the file is new
			if (!this.fileInitialized) {
				//console.log("File is new. Setting last content.");
				this.lastContent = newContent;
				this.fileInitialized = true;
				return;
			}

			// Split the old and new content into words and convert to lowercase
			const stopwords = new Set(this.settings.stopwords.split('\n').map(word => word.trim().toLowerCase()));

			const oldWords = (this.lastContent.match(/\b\w*[a-zA-Z]+\w*\b/g) || [])
				.map(word => word.toLowerCase())
				.filter(word => !stopwords.has(word)) as string[];

			const newWords = (newContent.match(/\b\w*[a-zA-Z]+\w*\b/g) || [])
				.map(word => word.toLowerCase())
				.filter(word => !stopwords.has(word)) as string[];

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

				const lowerCaseWord = word.toLowerCase(); // Convert the word to lowercase

				if (this.wordFrequency[lowerCaseWord]) {
					this.wordFrequency[lowerCaseWord] += delta; // Use the lowercase word as the key
				} else {
					this.wordFrequency[lowerCaseWord] = delta; // Use the lowercase word as the key
				}

				if (this.wordFrequency[lowerCaseWord] <= 0) {
					delete this.wordFrequency[lowerCaseWord]; // Use the lowercase word as the key
				}
			}

			// Update last known content
			this.lastContent = newContent;

			// Update status bar
			//const totalWords = Object.keys(this.wordFrequency).length;
			//this.statusBar.setText(`${totalWords} unique words today`);

			// Schedule an update for the daily MD file
			if (!this.updateScheduled) {
				this.updateScheduled = true;
				setTimeout(async () => {
					await this.updateDailyMdFile();
					this.updateScheduled = false;
				}, this.settings.updateFrequency);
			}

			// Update the state
			this.state.wordFrequency = this.wordFrequency;
			this.state.currentFile = this.currentFile;
			this.state.lastContent = this.lastContent;

			// Save the state to disk
			await this.saveData(this.state);
			//console.log("Updated state:", this.state);
		}
	}

	// Update the daily Markdown file with the word frequencies
	private async updateDailyMdFile(): Promise<void> {
		try {
			const vault = this.app.vault;
			const today = getLocalDate();
			let fileName = `${this.settings.folderPath}/WordScraper-${today}.md`;

			// Remove leading slash if it exists
			if (fileName.startsWith('/')) {
				fileName = fileName.substring(1);
			}

			this.dailyMdFile = await vault.getAbstractFileByPath(fileName) as TFile;

			// If the file doesn't exist, create it and reset the state
			if (!this.dailyMdFile) {
				await this.exportToJson(); // Before creating new file, export previous to JSON
				await this.resetState();  // Reset the state when a new file is created
				this.dailyMdFile = await vault.create(fileName, '');
			}

			// Generate the content with additional checks
			const content = [
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

	// Reset the state variables and save to disk
	private async resetState(): Promise<void> {
		console.log("Resetting state...");
		this.fileInitialized = false;
		this.state = {
			wordFrequency: {},
			lastKnownDate: getLocalDate(),
			currentFile: "",
			lastContent: "",
			settings: this.settings
		};
		this.state.wordFrequency = {};
		this.state.lastKnownDate = getLocalDate();
		this.state.currentFile = "";
		this.state.lastContent = "";
		this.state.settings = this.settings;
		this.wordFrequency = this.state.wordFrequency;
		this.lastKnownDate = this.state.lastKnownDate;
		this.currentFile = this.state.currentFile;
		this.lastContent = this.state.lastContent;
		await this.saveData(this.state);
		console.log("State after reset:", this.state);
	}


	// Used for manual resetting
	private async resetDailyMdFileAndState(): Promise<void> {
		// Reset the state
		await this.resetState();

		// Reset the daily Markdown file
		if (this.dailyMdFile) {
			await this.app.vault.modify(this.dailyMdFile, ''); // Empty the file
		} else {
			new Notice('No daily Markdown file to reset.');
		}
	}



	// Open the daily word file
	private async openDailyWordFile(): Promise<void> {
		//console.log("Opening daily word file...");
		const vault = this.app.vault;
		const today = getLocalDate();
		const fileName = `${this.settings.folderPath}/WordScraper-${today}.md`;

		// If the file doesn't exist, create it and reset the state
		if (!this.dailyMdFile) {
			await this.exportToJson(); // Before creating new file, export previous to JSON
			await this.resetState();  // Reset the state when a new file is created
			this.dailyMdFile = await vault.create(fileName, '');
		}
		if (this.dailyMdFile) {
			this.app.workspace.getLeaf().openFile(this.dailyMdFile);
		} else {
			new Notice('Failed to open or create daily word file.');
		}
	}

	private async exportToJson(): Promise<void> {
		if (!this.settings.enableJsonExport) {
			new Notice('JSON Export is disabled in settings. Please enable it to proceed.');
			return;
		}

		const latestFile = await this.findLatestWordScraperFile();
		console.log(`Exporting ${latestFile?.basename} to JSON...`);
		if (!latestFile) {
			return;
		}

		// Read the content of the latest WordScraper file
		const content = await this.app.vault.read(latestFile);
		const wordFrequency = this.parseWordFrequencies(content);

		const vault = this.app.vault;
		const jsonExportPath = this.settings.jsonExportPath || this.settings.folderPath;
		const jsonFileName = `${jsonExportPath}/${latestFile.basename}.json`;

		const jsonData = Object.entries(wordFrequency)
			.map(([word, frequency], index) => {
				const sentimentResult = this.sentiment.analyze(word);
				return {
					id: index + 1,
					word,
					frequency,
					sentiment: sentimentResult.score
				};
			})
			.filter(entry => entry.frequency > 0);

		if (jsonData.length === 0) {
			return;
		}

		const wrappedJsonData = {
			words: jsonData
		};

		const existingFile = await vault.getAbstractFileByPath(jsonFileName) as TFile;
		if (existingFile) {
			await vault.delete(existingFile);
		}

		await vault.create(jsonFileName, JSON.stringify(wrappedJsonData, null, 2));
		console.log(`JSON File ${jsonFileName} created!`);
	}


	private async findLatestWordScraperFile(): Promise<TFile | null> {
		const folderPath = this.settings.folderPath;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!folder || folder instanceof TFile) {
			return null;
		}

		const files = (folder as TFolder).children.filter(file => file instanceof TFile) as TFile[];
		const wordScraperFiles = files.filter(file => file.basename.startsWith("WordScraper-"));

		if (wordScraperFiles.length === 0) {
			return null;
		}
		return wordScraperFiles[wordScraperFiles.length - 1];
	}

	private parseWordFrequencies(content: string): { [key: string]: number } {
		const wordFrequency: { [key: string]: number } = {};
		const lines = content.split('\n');

		for (const line of lines) {
			const match = line.match(/^(\w+):\s*(\d+)$/);
			if (match) {
				const word = match[1];
				const frequency = parseInt(match[2], 10);
				wordFrequency[word] = frequency;
			}
		}

		return wordFrequency;
	}

	// Load settings from disk
	async loadSettings() {
		const savedState = await this.loadData();
		if (savedState && savedState.settings) {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, savedState.settings);
		} else {
			this.settings = DEFAULT_SETTINGS;
		}
	}

	// Save settings to disk
	async saveSettings() {
		//console.log("Saving settings...");
		this.state.settings = this.settings;
		await this.saveData(this.state);
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
		new Setting(containerEl)
			.setName('Update Frequency')
			.setDesc('Set the frequency for updating the WordScraper file (in milliseconds).')
			.addText(text => text
				.setPlaceholder('milliseconds')
				.setValue(this.plugin.settings.updateFrequency.toString())
				.onChange(async (value) => {
					this.plugin.settings.updateFrequency = parseInt(value, 10);
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Stopwords')
			.setDesc('Enter words to exclude, separated by new lines.')
			.addTextArea(text => text
				.setPlaceholder('Enter stopwords')
				.setValue(this.plugin.settings.stopwords)
				.onChange(async (value) => {
					this.plugin.settings.stopwords = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Enable JSON Export')
			.setDesc('Toggle to enable JSON export. Enables command palette item and automatic export.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableJsonExport)
				.onChange(async (value) => {
					this.plugin.settings.enableJsonExport = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Enable Automatic JSON Export')
			.setDesc('Toggle to enable automatic JSON export. When a new WordScraper file is created, a JSON file of the previous one will be created.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutomaticJsonExport)
				.onChange(async (value) => {
					this.plugin.settings.enableAutomaticJsonExport = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('JSON Export Path')
			.setDesc('Specify the folder path to export the JSON file.')
			.addText(text => text
				.setPlaceholder('Enter JSON export path')
				.setValue(this.plugin.settings.jsonExportPath)
				.onChange(async (value) => {
					this.plugin.settings.jsonExportPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
