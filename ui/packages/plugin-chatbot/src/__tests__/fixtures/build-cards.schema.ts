// Vendored from objectstack-ai/cloud packages/service-ai-studio/schema/build-cards.schema.json at f0ecef3a (cloud PR #3111); the object below is that file verbatim.
//
// objectui#12724 — the producer's contract for the two build cards the chat draws:
// `ProposeBlueprintCardPayload` (`propose_blueprint`'s `planCard`, beside the
// blueprint) and `BuildResultCardPayload` (`apply_blueprint` / `verify_build`'s
// `checklist` and `nextSteps`). The cloud repository is private, so the copy
// lives here, as a test fixture: `buildCards.contract-12724.test.ts` checks every
// fixture payload this package's card tests use against it. Refresh it by
// copying that file again at a newer sha and renaming the sha above; never edit
// the object by hand.
export const BUILD_CARDS_SCHEMA: Record<string, unknown> =
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$comment": "GENERATED from packages/service-ai-studio/src/build-cards.ts (buildCardJsonSchema) by src/__tests__/build-cards.contract.test.ts — rewrite it with `vitest -u`, never by hand.",
  "title": "AI build cards: the propose_blueprint plan card and the apply_blueprint / verify_build result card",
  "$defs": {
    "ProposeBlueprintCardPayload": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "blueprint_proposed"
        },
        "blueprint": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        },
        "viewIntents": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "view": {
                "type": "string",
                "minLength": 1
              },
              "object": {
                "type": "string",
                "minLength": 1
              },
              "label": {
                "type": "string",
                "minLength": 1
              },
              "line": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "view",
              "object",
              "line"
            ],
            "additionalProperties": false
          }
        },
        "planCard": {
          "type": "object",
          "properties": {
            "objects": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1
                  },
                  "label": {
                    "type": "string",
                    "minLength": 1
                  },
                  "fields": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "name": {
                          "type": "string",
                          "minLength": 1
                        },
                        "label": {
                          "type": "string",
                          "minLength": 1
                        },
                        "type": {
                          "type": "string",
                          "minLength": 1
                        },
                        "format": {
                          "type": "object",
                          "properties": {
                            "kind": {
                              "type": "string",
                              "enum": [
                                "isbn13",
                                "email",
                                "phone",
                                "url"
                              ]
                            },
                            "label": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "kind",
                            "label"
                          ],
                          "additionalProperties": false
                        },
                        "lifecycle": {
                          "type": "object",
                          "properties": {
                            "options": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "properties": {
                                  "value": {
                                    "type": "string",
                                    "minLength": 1
                                  },
                                  "label": {
                                    "type": "string",
                                    "minLength": 1
                                  },
                                  "kind": {
                                    "type": "string",
                                    "enum": [
                                      "open",
                                      "won",
                                      "lost"
                                    ]
                                  }
                                },
                                "required": [
                                  "value",
                                  "label",
                                  "kind"
                                ],
                                "additionalProperties": false
                              }
                            },
                            "label": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "options",
                            "label"
                          ],
                          "additionalProperties": false
                        },
                        "suggested": {
                          "type": "boolean",
                          "const": true
                        }
                      },
                      "required": [
                        "name",
                        "label",
                        "type"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "nameField": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "minLength": 1
                      },
                      "label": {
                        "type": "string",
                        "minLength": 1
                      },
                      "generated": {
                        "type": "object",
                        "properties": {
                          "template": {
                            "type": "string",
                            "minLength": 1
                          },
                          "line": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "template",
                          "line"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "name",
                      "label"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "name",
                  "label",
                  "fields"
                ],
                "additionalProperties": false
              }
            },
            "views": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "view": {
                    "type": "string",
                    "minLength": 1
                  },
                  "object": {
                    "type": "string",
                    "minLength": 1
                  },
                  "label": {
                    "type": "string",
                    "minLength": 1
                  },
                  "layout": {
                    "type": "string",
                    "enum": [
                      "list",
                      "form",
                      "kanban",
                      "calendar",
                      "gallery",
                      "gantt"
                    ]
                  },
                  "groupBy": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "minLength": 1
                      },
                      "label": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "name",
                      "label"
                    ],
                    "additionalProperties": false
                  },
                  "filters": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "field": {
                          "type": "string",
                          "minLength": 1
                        },
                        "operator": {
                          "type": "string",
                          "minLength": 1
                        },
                        "value": {}
                      },
                      "required": [
                        "field",
                        "operator"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "sort": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "field": {
                          "type": "string",
                          "minLength": 1
                        },
                        "order": {
                          "type": "string",
                          "enum": [
                            "asc",
                            "desc"
                          ]
                        }
                      },
                      "required": [
                        "field",
                        "order"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "fields": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "name": {
                          "type": "string",
                          "minLength": 1
                        },
                        "label": {
                          "type": "string",
                          "minLength": 1
                        }
                      },
                      "required": [
                        "name",
                        "label"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "line": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "view",
                  "object",
                  "layout",
                  "filters",
                  "sort",
                  "fields",
                  "line"
                ],
                "additionalProperties": false
              }
            },
            "assumptions": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "sampleData": {
              "type": "object",
              "properties": {
                "objects": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "object": {
                        "type": "string",
                        "minLength": 1
                      },
                      "label": {
                        "type": "string",
                        "minLength": 1
                      },
                      "rows": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "object",
                      "label",
                      "rows"
                    ],
                    "additionalProperties": false
                  }
                },
                "unique": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "object": {
                        "type": "string",
                        "minLength": 1
                      },
                      "fields": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "name": {
                              "type": "string",
                              "minLength": 1
                            },
                            "label": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "name",
                            "label"
                          ],
                          "additionalProperties": false
                        }
                      }
                    },
                    "required": [
                      "object",
                      "fields"
                    ],
                    "additionalProperties": false
                  }
                },
                "formats": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "object": {
                        "type": "string",
                        "minLength": 1
                      },
                      "field": {
                        "type": "string",
                        "minLength": 1
                      },
                      "label": {
                        "type": "string",
                        "minLength": 1
                      },
                      "format": {
                        "type": "object",
                        "properties": {
                          "kind": {
                            "type": "string",
                            "enum": [
                              "isbn13",
                              "email",
                              "phone",
                              "url"
                            ]
                          },
                          "label": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "kind",
                          "label"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "object",
                      "field",
                      "label",
                      "format"
                    ],
                    "additionalProperties": false
                  }
                },
                "line": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "objects",
                "unique",
                "formats",
                "line"
              ],
              "additionalProperties": false
            },
            "posture": {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "enum": [
                    "publish",
                    "draft"
                  ]
                },
                "liveRecords": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                "line": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "mode",
                "liveRecords",
                "line"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "objects",
            "views",
            "assumptions"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "status",
        "blueprint",
        "planCard"
      ],
      "additionalProperties": {}
    },
    "BuildResultCardPayload": {
      "type": "object",
      "properties": {
        "checklist": {
          "type": "object",
          "properties": {
            "status": {
              "type": "string",
              "enum": [
                "passed",
                "failed"
              ]
            },
            "passed": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "total": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            "lines": {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "kind": {
                        "type": "string",
                        "const": "object"
                      },
                      "object": {
                        "type": "string",
                        "minLength": 1
                      },
                      "label": {
                        "type": "string",
                        "minLength": 1
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "passed",
                          "failed"
                        ]
                      },
                      "fields": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "sampleRows": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "line": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "kind",
                      "object",
                      "label",
                      "status",
                      "line"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "kind": {
                        "type": "string",
                        "const": "view"
                      },
                      "view": {
                        "type": "string",
                        "minLength": 1
                      },
                      "object": {
                        "type": "string",
                        "minLength": 1
                      },
                      "label": {
                        "type": "string",
                        "minLength": 1
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "passed",
                          "failed"
                        ]
                      },
                      "matched": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "total": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      },
                      "groups": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "value": {
                              "type": "string",
                              "minLength": 1
                            },
                            "label": {
                              "type": "string",
                              "minLength": 1
                            },
                            "count": {
                              "type": "integer",
                              "minimum": 0,
                              "maximum": 9007199254740991
                            }
                          },
                          "required": [
                            "value",
                            "label",
                            "count"
                          ],
                          "additionalProperties": false
                        }
                      },
                      "line": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "kind",
                      "view",
                      "object",
                      "label",
                      "status",
                      "line"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "kind": {
                        "type": "string",
                        "const": "sampleData"
                      },
                      "status": {
                        "type": "string",
                        "const": "passed"
                      },
                      "unique": {
                        "type": "object",
                        "propertyNames": {
                          "type": "string"
                        },
                        "additionalProperties": {
                          "type": "array",
                          "items": {
                            "type": "string"
                          }
                        }
                      },
                      "formats": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "object": {
                              "type": "string",
                              "minLength": 1
                            },
                            "field": {
                              "type": "string",
                              "minLength": 1
                            },
                            "format": {
                              "type": "string",
                              "enum": [
                                "isbn13",
                                "email",
                                "phone",
                                "url"
                              ]
                            }
                          },
                          "required": [
                            "object",
                            "field",
                            "format"
                          ],
                          "additionalProperties": false
                        }
                      },
                      "line": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "kind",
                      "status",
                      "unique",
                      "formats",
                      "line"
                    ],
                    "additionalProperties": false
                  }
                ]
              }
            },
            "app": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1
                },
                "label": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "name"
              ],
              "additionalProperties": false
            },
            "packageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "status",
            "passed",
            "total",
            "lines"
          ],
          "additionalProperties": false
        },
        "nextSteps": {
          "minItems": 3,
          "maxItems": 3,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "required": [
        "checklist",
        "nextSteps"
      ],
      "additionalProperties": {}
    }
  }
}
;
