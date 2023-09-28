# Obsidian WordScraper

This is a plugin that captures the words you type into a new markdown file every day along with their frequencies.
## How does it work?

When you start typing, if one doesn't already exist with the same name, a new file will be generated with the name format `WordScraper-YYYY-MM-DD`. Any words typed in any other note will appear in this file, and any words deleted will be removed from the file. Duplicate words will increase the frequency count next to each word in the WordScraper file.

## Why?

I made this plugin originally for a project to capture the words I typed throughout the day in Obsidian in order to publish them as a word cloud on [my personal website](https://sean-a-ogrady.github.io/my-personal-website/), but I figured that others might be able to find a use for this!

Plus, this will be my first time publishing anything with the intention of other people using it, so I'm excited to gain this experience! In fact, while you're here, here are my links 👀:

https://github.com/sean-a-ogrady
https://www.linkedin.com/in/saogrady/

## Features

### Settings

- **WordScraper Folder** - Specify the folder path that you want to save WordScraper files to. By default, they are saved to the main vault folder. *Note: the folder must exist already.*
- **Excluded Folders** - Specify any folders you want to exclude from scraping. This is especially helpful for any documents/folders you consider private.
- **Update Frequency** - This is how often the WordScraper is updated with the new words you've typed/words you've deleted. By default, it is set to 10 seconds (10000 milliseconds).
- **Stopwords** - These are any words you want to exclude from being scraped. I've made a list of my suggested stopwords for WordScraper, which you can find [at this pastebin link](https://pastebin.com/zTy6Ej2f).
- **Enable JSON Export** - This toggle will enable an automatic export to JSON of the current file upon the creation of a new WordScraper file. It also enables the command palette item *Export Word Frequency to JSON*.
- **JSON Export Path** - Specify the folder path you want to save the exported JSON files to. By default, they are saved to the main vault folder. *Note: the folder must exist already.*

### Left Bar Icon

The pencil icon for WordScraper will open the daily WordScraper file, or create one if it doesn't exist already.

### Command Palette Items

- **Open Daily Word File** - Opens the WordScraper file for the current day, or creates it if it doesn't exist.
- **Export Word Frequency to JSON** - Exports the WordScraper file as a JSON file (*see notes on JSON export below*).
- **Reset Daily MD File and State** - Resets the WordScraper file, as well as any cached word data.

### Notes on JSON export

This will export the WordScraper file as a JSON file. Each word will look like this:

```json
{
    "id": 1,
    "word": "obsidian",
    "frequency": 2,
    "sentiment": 0
}
```

*The sentiment property uses natural language processing in order to calculate a sentiment score for each word. For example:*

```json
{
    "id": 2,
    "word": "good",
    "frequency": 1,
    "sentiment": 3
}
```

*And for negative sentiment:*

```json
{
    "id": 3,
    "word": "bad",
    "frequency": 1,
    "sentiment": -3
}
```

In the future, I plan to add more interesting data attached to each word. 

## Known Bugs

*Please share with me any feedback on how to improve my project! At the moment, it is functional, but definitely has some bugs.*

- [ ] State clearing is quite buggy
- [ ] Settings will sometimes not save
- [ ] Some words remain even after deletion
- [ ] Words with apostrophes won't be scraped
- [ ] Words with hyphens won't be scraped
- [ ] JSON Export formatting