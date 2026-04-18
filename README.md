# Selenium Helper Extension

Smart Chrome Extension for Selenium testers that helps inspect web elements and generate Selenium Java + TestNG code with better locator recommendations.
<img width="1856" height="2304" alt="Selenium Helper" src="https://github.com/user-attachments/assets/15400d16-d004-4dff-83e2-6eda22249a2f" />


## Features

- Select any element directly from the page
- Hover highlight before selection
- Multiple locator suggestions with score stars
- Smart locator ranking
- Java/TestNG code generation
- Page Object mode
- BasePage-compatible output
- History of selected elements
- iframe and nested frame support
- Copy-to-clipboard feedback
- Friendly error dialog

## Why this project is useful

Writing Selenium locators manually can be repetitive and error-prone. This extension speeds up the workflow by helping testers inspect elements visually, compare locator options, and generate cleaner automation code faster.

## Screenshots
<img width="343" height="462" alt="image" src="https://github.com/user-attachments/assets/3bb363ba-72ed-44ca-8012-eaeb6da6b88f" />
<br>
<img width="330" height="479" alt="image" src="https://github.com/user-attachments/assets/03d02033-22c1-427b-89cd-bb2f840085d0" />

<br>


## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project folder

## Usage

1. Open any webpage
2. Click **Select Element** in the extension popup
3. Hover over the target element
4. Click the element to capture it
5. Review the suggested locators
6. Pick the best locator
7. Copy the generated Selenium code

## Generated Output Styles

- Normal Selenium
- Page Object (`@FindBy`)
- BasePage-compatible Page Object output

## Supported Actions

- Click
- Send Keys
- Get Text
- Assert Visible

## Smart Features

- Locator score stars
- Better selector ranking
- History of selected elements
- iframe / nested frame awareness
- Copy success feedback
- Friendly error dialog

## Tech Stack

- Chrome Extension Manifest V3
- HTML
- CSS
- Vanilla JavaScript

## Roadmap

- Stronger selector intelligence
- Better weak-locator warnings
- GitHub-friendly releases
- More export options
- Improved UI polish

## Developer

By **Waheed Ibrahim**

GitHub: https://github.com/PuuNii

