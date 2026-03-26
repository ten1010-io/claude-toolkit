# AQA Gen - AI QA Automation Scenario Generator

Interactively generates YAML scenario files. Asks the user for required information, then creates a YAML file containing both success and error cases.

## Language

**CRITICAL:** You MUST detect the user's language from their messages and use that language for ALL interactions — questions, examples, outputs, error messages, and generated YAML content (action fields). Do NOT use the English examples written in this skill document as-is. Translate them into the user's language before presenting. The examples below are written in English only as a reference for the AI; they must never be shown to the user in English if the user speaks a different language.

## Trigger

Use when the user wants to create or generate a new QA test scenario YAML file, or asks to scaffold a test scenario.

## Arguments

None. Runs interactively to collect input.

## Workflow

Follow the steps below **exactly**.

### 1. Collect User Input

Use the AskUserQuestion tool to ask the following items **one at a time**, in order.
Include examples in each question so the user can answer easily.

#### Required Items

1. **Feature Name**
   > "What feature do you want to create a scenario for? (e.g., Login, Signup, Project Creation)"

2. **Description**
   > "Describe this feature in one line. (e.g., User authentication to access the system)"

3. **Login Required (Pre-authentication)**
   > "Does this feature require login to test? (Y/n)"
   > "If Y, login steps will be automatically prepended to every case."

   - If **Y** (or empty): ask the following sub-questions:
     > "What is the login page URL path? (e.g., /welcome, /login)"

     > "Provide the login credentials in key=value format."
     > "(e.g., login_username=admin, login_password=Secret123!)"

   - If **n**: skip — no login steps will be added.
   - Store the login page path and credentials separately. These are **not** part of the feature's test_data — they are only used to prepend login steps.
   - Login steps are a **precondition**, not a test target. No assertions or error cases are generated for login steps.

4. **Target Page URL Path**
   > "What is the URL path of the page to test? (e.g., /projects/new, /users, /settings)"
   > "You can also enter a full URL. (e.g., https://example.com/projects/new)"

   - If a full URL is entered, the domain part is automatically converted to `${BASE_URL}`.
   - If only a path is entered, it is used as `${BASE_URL}{path}`.
   - This value is also used when auto-generating error cases.

5. **Test Data (Success Case)**
   > "Provide the test data for the success case in key=value format, separated by commas."
   > "(e.g., project_name=MyProject, description=Test project)"
   > "Enter 'none' if not needed."

6. **Success Case Steps**
   > "Describe the steps for the success case, one per line."
   > "Write freely in natural language."
   > ""
   > "Examples:"
   > "Navigate to ${BASE_URL}/welcome and verify URL contains /welcome"
   > "Enter ${username} in the ID input field"
   > "Enter ${password} in the password field"
   > "Click the login button and wait for page load"
   > "Verify that Dashboard text is visible (15 second timeout)"
   > ""
   > "Type 'done' when finished."

7. **Auto-generate Error Cases**
   > "Would you like to automatically add error cases (failure scenarios) for this feature? (Y/n)"
   > "If Y, AI will auto-generate common error cases."
   > "Type 'manual' if you want to specify error cases yourself."

   - User enters **Y** (or empty): → proceed to **Step 3: Auto-generate Error Cases**
   - User enters **n**: → generate only the success case without error cases
   - User enters **manual**: → collect error cases with additional questions:
     > "Please provide error cases one at a time in this format:"
     > "Case name | data_to_change(key=value) | expected_result"
     > ""
     > "Examples:"
     > "Wrong password | password=wrongpass!! | Invalid username or password"
     > "Non-existent account | username=nobody123 | Invalid username or password"
     > "Empty fields | username=, password= | Please enter your ID"
     > ""
     > "Type 'done' when finished."

8. **Save Path**
   > "Enter the file path to save. (default: current directory)"
   > "(e.g., scenarios/auth/login.yaml)"
   > "If you enter only a filename, it will be saved in the current directory."

### 2. Parse Input

Parse the collected input according to the rules below.

#### Tags (Auto-generated)
- Do NOT ask the user for tags. Generate them automatically from the feature name and description.
- Examples: feature "Login" → `[auth, login]`, feature "Project Creation" → `[project, create]`, feature "User Search" → `[user, search]`
- Keep 2-3 relevant tags.

#### Test Data
- Parse `key=value` pairs into a `test_data` map.
- Keys containing `password`, `secret`, `token`, etc. automatically set `sensitive: true` on the relevant steps.
- If "none", omit `test_data`.

#### Steps Parsing
Convert the user's natural language sentences into step objects:

- `action`: use the natural language sentence as-is (may contain `${...}` variables)

> A single `action` field describes all behavior. When aqa-run executes, AI interprets the natural language and runs the appropriate browser-use commands.

#### File Path
- If no extension, append `.yaml`.
- If a relative path, resolve relative to the current working directory.
- If the directory doesn't exist, create it automatically.

### 3. Auto-generate Error Cases

If the user chose auto-generation, automatically create common error cases based on the feature type.

Error case steps use the **target page URL path collected in step 3** to construct page navigation steps as `${BASE_URL}{path}`. The success case's step flow is used as the base, with variations that trigger errors.

#### Error Case Patterns by Feature Type

**Login-related** (feature/action contains "login", "sign in", "authentication"):
- Wrong password: change password to "wrongpassword!!"
- Non-existent account: change username to "nonexistent_user_999"
- Empty username: set username to empty, enter only password
- Empty password: enter only username, set password to empty
- All fields empty: submit without entering anything

**Signup-related** (feature/action contains "signup", "register", "sign up", "create account"):
- Duplicate email/username: use an already existing value
- Password mismatch: enter a different value in the confirm password field
- Invalid email format: use "invalid-email"
- Short password: use "123"
- Missing required fields: leave each required field empty one at a time

**Search-related** (feature/action contains "search"):
- No results: use "zzz_no_result_query_999"
- Empty search query: search with an empty value
- Special characters: use `<script>alert(1)</script>`

**Form submission-related** (feature/action contains "create", "submit", "register", "add"):
- Missing required fields: leave each required field empty one at a time
- Max length exceeded: enter a very long string
- Special character input: SQL injection patterns like `' OR 1=1 --`

**Other features**:
- Analyze the core input values and generate error cases with empty values, invalid values, boundary values, etc.

#### Error Case Generation Rules

Each error case is constructed as follows:

1. **name**: Clearly describe the error situation (e.g., "Login attempt with wrong password")
2. **priority**: One level lower than the success case (critical → high, high → medium)
3. **test_data**: Copy from the success case's test_data, then change values to trigger errors
4. **steps**: Based on the success case's steps, but:
   - Modify the action of steps where input values differ
   - Replace the last verification step with error message verification
   - For empty input cases, remove the corresponding input step
5. **expected_result**: "fail" (this case expects an error as normal behavior)

> If the expected error message is unknown, use `visual` type assertion so AI can look at the screen and determine whether an error state is shown.

### 4. Generate YAML

Fill the template below with parsed values and generate the YAML file.
Save the file using the Write tool.

#### Login Precondition Steps

If the user answered **Y** to "Login Required" (step 3), prepend the following steps to **every** case's `steps` array. Also add `login_username` and `login_password` to each case's `test_data`.

```yaml
# These steps are auto-prepended to every case when login is required:
- action: "Navigate to ${BASE_URL}{login_page_path}"
- action: "Enter ${login_username} in the ID input field"
- action: "Enter ${login_password} in the password field"
  sensitive: true
- action: "Click the login button and wait for page load"
```

These login steps are a **precondition only** — no assertions are added, and no error cases are generated for them. They simply ensure the user is authenticated before the actual test begins.

#### Cases Structure (with error cases)

```yaml
name: "{Feature Name}"
description: "{Description}"
tags: [{tags}]

cases:
  - name: "{Success Case Name}"
    priority: critical
    expected_result: "pass"
    test_data:
      login_username: "{login_user}"     # only if login required
      login_password: "{login_pass}"     # only if login required
      {key}: "{value}"
    steps:
      # Login precondition (auto-inserted if login required)
      - action: "Navigate to ${BASE_URL}{login_path}"
      - action: "Enter ${login_username} in the ID input field"
      - action: "Enter ${login_password} in the password field"
        sensitive: true
      - action: "Click the login button and wait for page load"
      # Actual test steps
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies

  - name: "{Error Case 1 Name}"
    priority: high
    expected_result: "fail"
    test_data:
      {key}: "{modified value}"
    steps:
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies

  - name: "{Error Case 2 Name}"
    priority: medium
    expected_result: "fail"
    test_data:
      {key}: "{modified value}"
    steps:
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies
```

#### Single Case Structure (success only, no error cases)

Even without error cases, use the `cases` structure for consistency.

```yaml
name: "{Feature Name}"
description: "{Description}"
tags: [{tags}]

cases:
  - name: "{Success Case Name}"
    priority: critical
    expected_result: "pass"
    test_data:
      {key}: "{value}"
    steps:
      - action: "{Natural language action description}"
    cleanup:
      - type: clear_cookies
```

### 5. Output Results

After file creation, output in this format:

```
====================================
Scenario generated!
File: {save path}
Feature: {feature name}
Cases: {total case count} (Success: {N}, Error: {M})
====================================
```

Then show the generated YAML content in a code block.

### 6. Execution Guide

Finally, provide instructions on how to run:

```
To run: /aqa-run {save path}
```

## Notes

- If the user's answer is ambiguous, ask follow-up questions for clarification.
- When the user enters steps in natural language, use the text directly as the `action` field.
- `${BASE_URL}` is always prepended to URLs. Even if the user enters a full URL, convert it to `${BASE_URL}` + path format.
- `cleanup` includes `clear_cookies` by default for each case.
- If the file already exists, ask the user whether to overwrite it.
- If the expected error message for an error case is unknown, use a `visual` assertion instead:
  ```yaml
  assertions:
    - type: visual
      value: "Is an error message or warning displayed?"
  ```
- Cases with `expected_result: "fail"` are judged as **pass** when the error message is correctly displayed (the error occurring is the expected normal behavior).
