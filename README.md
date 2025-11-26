# Barista Tips - Starbucks Tip Distribution Assistant

A web application that uses OCR to extract partner data from Tips Distribution Reports and automatically calculates fair tip distribution with denomination breakdown.

## Features

- Upload and preprocess tip distribution report images
- Azure Document Intelligence OCR integration for automatic data extraction
- Editable partner table for corrections
- Smart tip calculation based on tippable hours
- Fair denomination distribution algorithm
- Starbucks-themed responsive UI
- CSV export and print functionality

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Netlify Functions (Node.js)
- **OCR**: Azure Document Intelligence Prebuilt Layout Model

## Setup

### Prerequisites

- Node.js 18+ and npm
- Azure Document Intelligence resource

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables in Netlify:
   - `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`: Your Azure endpoint URL
   - `AZURE_DOCUMENT_INTELLIGENCE_KEY`: Your Azure API key

   For local development, create a `.env` file:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

### Local Development

```bash
npm run dev
```

This starts Netlify Dev, which serves the frontend and functions locally.

### Deployment

1. Push to GitHub
2. Connect repository to Netlify
3. Set environment variables in Netlify dashboard
4. Deploy (automatic on push)

## Project Structure

```
/
├── src/
│   ├── index.html       # Main HTML file
│   ├── styles.css       # Starbucks-themed styles
│   └── main.js          # Frontend logic
├── netlify/
│   └── functions/
│       └── ocr.js       # Azure Document Intelligence integration
├── netlify.toml         # Netlify configuration
└── package.json         # Dependencies
```

## Usage

1. Upload a photo/screenshot of your Tips Distribution Report
2. The app preprocesses the image (grayscale + binarization)
3. Azure OCR extracts partner names, numbers, and hours
4. Review and edit the extracted data if needed
5. Enter total tips and available bill denominations
6. Click "Calculate Tips" to see distribution
7. Export to CSV or print the results

## Security

- All Azure credentials are stored as environment variables
- No secrets are exposed in frontend code
- Image processing happens client-side before upload
- Backend validates all inputs

## License

MIT
