import { google, sheets_v4 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export class SheetsClient {
  private sheets: sheets_v4.Sheets;

  constructor(auth: OAuth2Client) {
    this.sheets = google.sheets({ version: "v4", auth });
  }

  /**
   * Append rows to the end of the tab's existing data.
   *
   * Uses `valueInputOption: "USER_ENTERED"` so formulas, dates, and currency
   * strings get parsed the same way the Sheets UI would parse them. Returns
   * how many rows were written and the A1 range that was updated.
   *
   * `rows` is a list of rows; each row is a list of cell values. Mixed types
   * (strings, numbers, booleans) are accepted.
   */
  async appendRows(
    spreadsheetId: string,
    sheetName: string,
    rows: (string | number | boolean | null)[][]
  ): Promise<{ updatedRange: string; updatedRows: number; updatedCells: number }> {
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetName,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
    const updates = res.data.updates || {};
    return {
      updatedRange: updates.updatedRange || "",
      updatedRows: updates.updatedRows || 0,
      updatedCells: updates.updatedCells || 0,
    };
  }

  /**
   * Overwrite the cells at `range` with new values. Range is A1 notation,
   * e.g. "2026!B2:E5" or "Dashboard!A1".
   *
   * Fewer rows/cols in `values` than the range means the remaining cells are
   * untouched. More rows/cols than the range means the extra values are
   * ignored. Use appendRows to grow the sheet instead.
   */
  async updateRange(
    spreadsheetId: string,
    range: string,
    values: (string | number | boolean | null)[][]
  ): Promise<{ updatedRange: string; updatedRows: number; updatedCells: number }> {
    const res = await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
    return {
      updatedRange: res.data.updatedRange || "",
      updatedRows: res.data.updatedRows || 0,
      updatedCells: res.data.updatedCells || 0,
    };
  }

  /**
   * Insert blank rows at `startRowIndex` (0-based) and then fill them with
   * `rows`. Existing rows below are shifted down.
   *
   * Unlike appendRows (which always writes to the bottom), this keeps the
   * rest of the tab's structure intact — useful when the sheet has a
   * "NOT Ready" divider or footer that needs to stay at the bottom.
   *
   * Requires the sheet's internal numeric `sheetId`, not the tab name. Look
   * it up with getSheetId().
   */
  async insertRowsAt(
    spreadsheetId: string,
    sheetId: number,
    startRowIndex: number,
    rows: (string | number | boolean | null)[][]
  ): Promise<void> {
    if (rows.length === 0) return;
    // Step 1: insert blank rows
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: startRowIndex,
                endIndex: startRowIndex + rows.length,
              },
              inheritFromBefore: false,
            },
          },
        ],
      },
    });
    // Step 2: fill the new rows. Use values.update with the same A1 range.
    const sheetName = await this.getSheetName(spreadsheetId, sheetId);
    const range = `'${sheetName}'!A${startRowIndex + 1}`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  }

  /**
   * Clear the values in a range (keeps formatting). Range is A1 notation.
   */
  async clearRange(spreadsheetId: string, range: string): Promise<void> {
    await this.sheets.spreadsheets.values.clear({ spreadsheetId, range });
  }

  /**
   * Look up a sheet's numeric sheetId by its tab name. Needed for the raw
   * batchUpdate API which uses numeric IDs rather than names.
   */
  async getSheetId(spreadsheetId: string, sheetName: string): Promise<number> {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const sheet = (res.data.sheets || []).find(
      (s) => s.properties?.title === sheetName
    );
    if (!sheet || sheet.properties?.sheetId == null) {
      throw new Error(`Sheet/tab "${sheetName}" not found in ${spreadsheetId}`);
    }
    return sheet.properties.sheetId;
  }

  async getSheetName(spreadsheetId: string, sheetId: number): Promise<string> {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const sheet = (res.data.sheets || []).find(
      (s) => s.properties?.sheetId === sheetId
    );
    if (!sheet || !sheet.properties?.title) {
      throw new Error(`Sheet with sheetId=${sheetId} not found in ${spreadsheetId}`);
    }
    return sheet.properties.title;
  }

  /**
   * Add a new tab/sheet to an existing spreadsheet.
   */
  async addSheet(
    spreadsheetId: string,
    title: string
  ): Promise<{ sheetId: number; title: string }> {
    const res = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
    const props =
      res.data.replies?.[0]?.addSheet?.properties || ({} as sheets_v4.Schema$SheetProperties);
    return {
      sheetId: props.sheetId ?? 0,
      title: props.title || title,
    };
  }

  /**
   * Delete a tab/sheet from an existing spreadsheet.
   */
  async deleteSheet(spreadsheetId: string, sheetId: number): Promise<void> {
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ deleteSheet: { sheetId } }],
      },
    });
  }

  /**
   * Create a new Google Sheets spreadsheet with the given title. Returns the
   * new spreadsheet's ID.
   */
  async createSpreadsheet(title: string): Promise<{ spreadsheetId: string; title: string }> {
    const res = await this.sheets.spreadsheets.create({
      requestBody: { properties: { title } },
    });
    return {
      spreadsheetId: res.data.spreadsheetId || "",
      title: res.data.properties?.title || title,
    };
  }

  /**
   * Raw escape hatch: run an arbitrary list of Sheets API batchUpdate
   * requests atomically. Use for operations not covered by the higher-level
   * methods above (formatting, merges, data validation, conditional formats,
   * etc.). See https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/request
   */
  async batchUpdate(
    spreadsheetId: string,
    requests: sheets_v4.Schema$Request[]
  ): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
    const res = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    return res.data;
  }
}
