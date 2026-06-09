---
name: Bug report
description: Something isn't working as expected
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug. The more detail you provide, the faster we can reproduce and fix it.

  - type: textarea
    id: summary
    attributes:
      label: What happened?
      description: A clear description of the bug.
      placeholder: When I click Save on the WiFi controller form, nothing happens and the console shows…
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: What did you expect?
      placeholder: The controller should save and appear in the list.
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Go to WiFi → Controllers
        2. Click Add controller
        3. Fill in name and save
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Rackpad version
      placeholder: e.g. 1.6.0-beta.4
    validations:
      required: true

  - type: dropdown
    id: browser
    attributes:
      label: Browser / client (if UI bug)
      options:
        - Not applicable (server/API)
        - Chrome / Chromium
        - Firefox
        - Safari
        - Other

  - type: textarea
    id: logs
    attributes:
      label: Logs or screenshots
      description: Paste relevant console output, API errors, or attach screenshots.
      render: shell

  - type: checkboxes
    id: checklist
    attributes:
      label: Checklist
      options:
        - label: I searched existing issues for duplicates
          required: true
        - label: I can reproduce this on the latest beta/dev branch
          required: false
