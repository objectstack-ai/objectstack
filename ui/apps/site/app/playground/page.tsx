'use client';

import React, { useState, useEffect } from 'react';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import type { SchemaNode } from '@object-ui/core';
import dynamic from 'next/dynamic';
import { ObjectUIProvider } from '@/app/components/ObjectUIProvider';
// Registers `@object-ui/layout`'s blocks — see the module header (objectui#3787).
// The Playground renders hand-typed schemas, so it needs the same registration
// as the three catalog hosts: without it, typing `page-header` here produced the
// red OBJUI-001 "Unknown component type" panel for a component the rest of the
// docs site rendered fine (objectui#3904).
import '@/app/components/registerLayoutBlocks';
import { ChevronLeft, ChevronRight, Monitor, Smartphone, Tablet } from 'lucide-react';

// Dynamically import Monaco Editor to avoid SSR issues
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// Default example schema
const DEFAULT_SCHEMA: SchemaNode = {
  type: "div",
  className: "space-y-4",
  children: [
    {
      type: "text",
      content: "Welcome to ObjectUI Playground",
      className: "text-2xl font-bold"
    },
    {
      type: "text",
      content: "Edit the JSON schema on the left to see live updates here."
    },
    {
      type: "card",
      className: "p-6",
      children: [
        {
          type: "text",
          content: "Quick Example",
          className: "text-xl font-semibold mb-2"
        },
        {
          type: "text",
          content: "Try changing the text or adding new components!",
          className: "mb-4"
        },
        {
          type: "button",
          variant: "default",
          label: "Click me"
        }
      ]
    }
  ]
};

// Example schemas for users to try
const EXAMPLE_SCHEMAS = {
  basic: DEFAULT_SCHEMA,
  form: {
    type: "card",
    className: "max-w-2xl mx-auto",
    children: [
      {
        type: "div",
        className: "p-6 space-y-6",
        children: [
          {
            type: "div",
            className: "space-y-2",
            children: [
              {
                type: "text",
                content: "Contact Us",
                className: "text-3xl font-bold"
              },
              {
                type: "text",
                content: "Fill out the form below and we'll get back to you soon.",
                className: "text-muted-foreground"
              }
            ]
          },
          {
            type: "separator"
          },
          {
            type: "div",
            className: "grid grid-cols-2 gap-4",
            children: [
              {
                type: "div",
                className: "space-y-2",
                children: [
                  {
                    type: "label",
                    htmlFor: "firstName",
                    label: "First Name"
                  },
                  {
                    type: "input",
                    id: "firstName",
                    name: "firstName",
                    placeholder: "John"
                  }
                ]
              },
              {
                type: "div",
                className: "space-y-2",
                children: [
                  {
                    type: "label",
                    htmlFor: "lastName",
                    label: "Last Name"
                  },
                  {
                    type: "input",
                    id: "lastName",
                    name: "lastName",
                    placeholder: "Doe"
                  }
                ]
              }
            ]
          },
          {
            type: "div",
            className: "space-y-2",
            children: [
              {
                type: "label",
                htmlFor: "email",
                label: "Email Address"
              },
              {
                type: "input",
                id: "email",
                name: "email",
                inputType: "email",
                placeholder: "john.doe@example.com"
              }
            ]
          },
          {
            type: "div",
            className: "space-y-2",
            children: [
              {
                type: "label",
                htmlFor: "subject",
                label: "Subject"
              },
              {
                type: "select",
                id: "subject",
                name: "subject",
                placeholder: "Select a subject",
                options: [
                  { label: "General Inquiry", value: "general" },
                  { label: "Technical Support", value: "support" },
                  { label: "Sales", value: "sales" },
                  { label: "Partnership", value: "partnership" }
                ]
              }
            ]
          },
          {
            type: "div",
            className: "space-y-2",
            children: [
              {
                type: "label",
                htmlFor: "message",
                label: "Message"
              },
              {
                type: "textarea",
                id: "message",
                name: "message",
                placeholder: "Tell us more about your inquiry...",
                rows: 5
              }
            ]
          },
          {
            type: "div",
            className: "flex items-center gap-2",
            children: [
              {
                type: "checkbox",
                id: "newsletter",
                name: "newsletter"
              },
              {
                type: "label",
                htmlFor: "newsletter",
                label: "Subscribe to our newsletter"
              }
            ]
          },
          {
            type: "div",
            className: "flex gap-3",
            children: [
              {
                type: "button",
                variant: "default",
                label: "Send Message",
                className: "flex-1"
              },
              {
                type: "button",
                variant: "outline",
                label: "Reset"
              }
            ]
          }
        ]
      }
    ]
  },
  dashboard: {
    type: "div",
    className: "space-y-6",
    children: [
      {
        type: "div",
        className: "flex items-center justify-between",
        children: [
          {
            type: "div",
            children: [
              {
                type: "text",
                content: "Analytics Dashboard",
                className: "text-3xl font-bold"
              },
              {
                type: "text",
                content: "Overview of your business metrics",
                className: "text-muted-foreground mt-1"
              }
            ]
          },
          {
            type: "button",
            variant: "outline",
            label: "Download Report",
            icon: "Download"
          }
        ]
      },
      {
        type: "grid",
        columns: 4,
        gap: 4,
        children: [
          {
            type: "card",
            className: "p-6",
            children: [
              {
                type: "div",
                className: "flex items-center justify-between mb-2",
                children: [
                  {
                    type: "text",
                    content: "Total Revenue",
                    className: "text-sm font-medium text-muted-foreground"
                  },
                  {
                    type: "icon",
                    icon: "DollarSign",
                    className: "h-4 w-4 text-muted-foreground"
                  }
                ]
              },
              {
                type: "text",
                content: "$45,231.89",
                className: "text-2xl font-bold"
              },
              {
                type: "div",
                className: "flex items-center gap-1 mt-2",
                children: [
                  {
                    type: "text",
                    content: "+20.1%",
                    className: "text-sm font-medium text-green-600"
                  },
                  {
                    type: "text",
                    content: "from last month",
                    className: "text-sm text-muted-foreground"
                  }
                ]
              }
            ]
          },
          {
            type: "card",
            className: "p-6",
            children: [
              {
                type: "div",
                className: "flex items-center justify-between mb-2",
                children: [
                  {
                    type: "text",
                    content: "Active Users",
                    className: "text-sm font-medium text-muted-foreground"
                  },
                  {
                    type: "icon",
                    icon: "Users",
                    className: "h-4 w-4 text-muted-foreground"
                  }
                ]
              },
              {
                type: "text",
                content: "2,350",
                className: "text-2xl font-bold"
              },
              {
                type: "div",
                className: "flex items-center gap-1 mt-2",
                children: [
                  {
                    type: "text",
                    content: "+180.1%",
                    className: "text-sm font-medium text-green-600"
                  },
                  {
                    type: "text",
                    content: "from last month",
                    className: "text-sm text-muted-foreground"
                  }
                ]
              }
            ]
          },
          {
            type: "card",
            className: "p-6",
            children: [
              {
                type: "div",
                className: "flex items-center justify-between mb-2",
                children: [
                  {
                    type: "text",
                    content: "Sales",
                    className: "text-sm font-medium text-muted-foreground"
                  },
                  {
                    type: "icon",
                    icon: "CreditCard",
                    className: "h-4 w-4 text-muted-foreground"
                  }
                ]
              },
              {
                type: "text",
                content: "+12,234",
                className: "text-2xl font-bold"
              },
              {
                type: "div",
                className: "flex items-center gap-1 mt-2",
                children: [
                  {
                    type: "text",
                    content: "+19%",
                    className: "text-sm font-medium text-green-600"
                  },
                  {
                    type: "text",
                    content: "from last month",
                    className: "text-sm text-muted-foreground"
                  }
                ]
              }
            ]
          },
          {
            type: "card",
            className: "p-6",
            children: [
              {
                type: "div",
                className: "flex items-center justify-between mb-2",
                children: [
                  {
                    type: "text",
                    content: "Active Now",
                    className: "text-sm font-medium text-muted-foreground"
                  },
                  {
                    type: "icon",
                    icon: "Activity",
                    className: "h-4 w-4 text-muted-foreground"
                  }
                ]
              },
              {
                type: "text",
                content: "+573",
                className: "text-2xl font-bold"
              },
              {
                type: "div",
                className: "flex items-center gap-1 mt-2",
                children: [
                  {
                    type: "text",
                    content: "+201",
                    className: "text-sm font-medium text-green-600"
                  },
                  {
                    type: "text",
                    content: "since last hour",
                    className: "text-sm text-muted-foreground"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: "grid",
        columns: 2,
        gap: 4,
        children: [
          {
            type: "card",
            children: [
              {
                type: "div",
                className: "p-6",
                children: [
                  {
                    type: "text",
                    content: "Recent Activity",
                    className: "text-xl font-semibold mb-4"
                  },
                  {
                    type: "div",
                    className: "space-y-4",
                    children: [
                      {
                        type: "div",
                        className: "flex items-start gap-4",
                        children: [
                          {
                            type: "avatar",
                            fallback: "JD",
                            className: "h-10 w-10"
                          },
                          {
                            type: "div",
                            className: "flex-1 space-y-1",
                            children: [
                              {
                                type: "text",
                                content: "John Doe made a purchase",
                                className: "text-sm font-medium"
                              },
                              {
                                type: "text",
                                content: "2 minutes ago",
                                className: "text-xs text-muted-foreground"
                              }
                            ]
                          },
                          {
                            type: "badge",
                            label: "New",
                            variant: "default"
                          }
                        ]
                      },
                      {
                        type: "div",
                        className: "flex items-start gap-4",
                        children: [
                          {
                            type: "avatar",
                            fallback: "SM",
                            className: "h-10 w-10"
                          },
                          {
                            type: "div",
                            className: "flex-1 space-y-1",
                            children: [
                              {
                                type: "text",
                                content: "Sarah Miller subscribed",
                                className: "text-sm font-medium"
                              },
                              {
                                type: "text",
                                content: "10 minutes ago",
                                className: "text-xs text-muted-foreground"
                              }
                            ]
                          },
                          {
                            type: "badge",
                            label: "Pro",
                            variant: "secondary"
                          }
                        ]
                      },
                      {
                        type: "div",
                        className: "flex items-start gap-4",
                        children: [
                          {
                            type: "avatar",
                            fallback: "RJ",
                            className: "h-10 w-10"
                          },
                          {
                            type: "div",
                            className: "flex-1 space-y-1",
                            children: [
                              {
                                type: "text",
                                content: "Robert Johnson commented",
                                className: "text-sm font-medium"
                              },
                              {
                                type: "text",
                                content: "1 hour ago",
                                className: "text-xs text-muted-foreground"
                              }
                            ]
                          },
                          {
                            type: "badge",
                            label: "Comment",
                            variant: "outline"
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: "card",
            children: [
              {
                type: "div",
                className: "p-6",
                children: [
                  {
                    type: "text",
                    content: "Top Products",
                    className: "text-xl font-semibold mb-4"
                  },
                  {
                    type: "div",
                    className: "space-y-4",
                    children: [
                      {
                        type: "div",
                        className: "flex items-center justify-between",
                        children: [
                          {
                            type: "div",
                            className: "flex items-center gap-3",
                            children: [
                              {
                                type: "div",
                                className: "h-10 w-10 rounded bg-blue-100 dark:bg-blue-900 flex items-center justify-center",
                                children: [
                                  {
                                    type: "icon",
                                    icon: "Smartphone",
                                    className: "h-5 w-5 text-blue-600 dark:text-blue-400"
                                  }
                                ]
                              },
                              {
                                type: "div",
                                children: [
                                  {
                                    type: "text",
                                    content: "iPhone 15 Pro",
                                    className: "text-sm font-medium"
                                  },
                                  {
                                    type: "text",
                                    content: "1,234 sales",
                                    className: "text-xs text-muted-foreground"
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            type: "text",
                            content: "$999",
                            className: "font-semibold"
                          }
                        ]
                      },
                      {
                        type: "div",
                        className: "flex items-center justify-between",
                        children: [
                          {
                            type: "div",
                            className: "flex items-center gap-3",
                            children: [
                              {
                                type: "div",
                                className: "h-10 w-10 rounded bg-purple-100 dark:bg-purple-900 flex items-center justify-center",
                                children: [
                                  {
                                    type: "icon",
                                    icon: "Laptop",
                                    className: "h-5 w-5 text-purple-600 dark:text-purple-400"
                                  }
                                ]
                              },
                              {
                                type: "div",
                                children: [
                                  {
                                    type: "text",
                                    content: "MacBook Pro",
                                    className: "text-sm font-medium"
                                  },
                                  {
                                    type: "text",
                                    content: "856 sales",
                                    className: "text-xs text-muted-foreground"
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            type: "text",
                            content: "$1,999",
                            className: "font-semibold"
                          }
                        ]
                      },
                      {
                        type: "div",
                        className: "flex items-center justify-between",
                        children: [
                          {
                            type: "div",
                            className: "flex items-center gap-3",
                            children: [
                              {
                                type: "div",
                                className: "h-10 w-10 rounded bg-green-100 dark:bg-green-900 flex items-center justify-center",
                                children: [
                                  {
                                    type: "icon",
                                    icon: "Headphones",
                                    className: "h-5 w-5 text-green-600 dark:text-green-400"
                                  }
                                ]
                              },
                              {
                                type: "div",
                                children: [
                                  {
                                    type: "text",
                                    content: "AirPods Pro",
                                    className: "text-sm font-medium"
                                  },
                                  {
                                    type: "text",
                                    content: "542 sales",
                                    className: "text-xs text-muted-foreground"
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            type: "text",
                            content: "$249",
                            className: "font-semibold"
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  dataTable: {
    type: "div",
    className: "space-y-4",
    children: [
      {
        type: "div",
        className: "flex items-center justify-between",
        children: [
          {
            type: "div",
            children: [
              {
                type: "text",
                content: "User Management",
                className: "text-3xl font-bold"
              },
              {
                type: "text",
                content: "Manage your team members and their roles",
                className: "text-muted-foreground mt-1"
              }
            ]
          },
          {
            type: "button",
            variant: "default",
            label: "Add User",
            icon: "Plus"
          }
        ]
      },
      {
        type: "card",
        children: [
          {
            type: "div",
            className: "p-6",
            children: [
              {
                type: "table",
                columns: [
                  { 
                    header: "User",
                    accessorKey: "user"
                  },
                  { 
                    header: "Email",
                    accessorKey: "email"
                  },
                  { 
                    header: "Role",
                    accessorKey: "role"
                  },
                  { 
                    header: "Status",
                    accessorKey: "status"
                  },
                  { 
                    header: "Actions",
                    accessorKey: "actions"
                  }
                ],
                data: [
                  {
                    user: "John Doe",
                    email: "john@example.com",
                    role: "Admin",
                    status: "Active",
                    actions: "•••"
                  },
                  {
                    user: "Jane Smith",
                    email: "jane@example.com",
                    role: "Editor",
                    status: "Active",
                    actions: "•••"
                  },
                  {
                    user: "Bob Johnson",
                    email: "bob@example.com",
                    role: "Viewer",
                    status: "Inactive",
                    actions: "•••"
                  },
                  {
                    user: "Alice Williams",
                    email: "alice@example.com",
                    role: "Editor",
                    status: "Active",
                    actions: "•••"
                  },
                  {
                    user: "Charlie Brown",
                    email: "charlie@example.com",
                    role: "Viewer",
                    status: "Active",
                    actions: "•••"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: "div",
        className: "flex items-center justify-between",
        children: [
          {
            type: "text",
            content: "Showing 1 to 5 of 50 results",
            className: "text-sm text-muted-foreground"
          },
          {
            type: "pagination",
            currentPage: 1,
            totalPages: 10
          }
        ]
      }
    ]
  },
  ecommerce: {
    type: "div",
    className: "space-y-6",
    children: [
      {
        type: "div",
        className: "flex items-center justify-between",
        children: [
          {
            type: "text",
            content: "Featured Products",
            className: "text-3xl font-bold"
          },
          {
            type: "div",
            className: "flex gap-2",
            children: [
              {
                type: "button",
                variant: "outline",
                label: "Filter",
                icon: "Funnel"
              },
              {
                type: "button",
                variant: "outline",
                label: "Sort",
                icon: "ArrowUpDown"
              }
            ]
          }
        ]
      },
      {
        type: "grid",
        columns: 3,
        gap: 6,
        children: [
          {
            type: "card",
            className: "overflow-hidden",
            children: [
              {
                type: "div",
                className: "aspect-square bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900 dark:to-blue-800 flex items-center justify-center",
                children: [
                  {
                    type: "icon",
                    icon: "Smartphone",
                    className: "h-20 w-20 text-blue-600 dark:text-blue-400"
                  }
                ]
              },
              {
                type: "div",
                className: "p-4 space-y-3",
                children: [
                  {
                    type: "div",
                    className: "flex items-start justify-between",
                    children: [
                      {
                        type: "div",
                        children: [
                          {
                            type: "text",
                            content: "iPhone 15 Pro",
                            className: "font-semibold text-lg"
                          },
                          {
                            type: "text",
                            content: "Latest flagship phone",
                            className: "text-sm text-muted-foreground"
                          }
                        ]
                      },
                      {
                        type: "badge",
                        label: "New",
                        variant: "default"
                      }
                    ]
                  },
                  {
                    type: "div",
                    className: "flex items-center gap-2",
                    children: [
                      {
                        type: "text",
                        content: "$999",
                        className: "text-2xl font-bold"
                      },
                      {
                        type: "text",
                        content: "$1,099",
                        className: "text-sm text-muted-foreground line-through"
                      }
                    ]
                  },
                  {
                    type: "div",
                    className: "flex items-center gap-1",
                    children: [
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 text-gray-300"
                      },
                      {
                        type: "text",
                        content: "(128 reviews)",
                        className: "text-sm text-muted-foreground ml-1"
                      }
                    ]
                  },
                  {
                    type: "button",
                    variant: "default",
                    label: "Add to Cart",
                    className: "w-full"
                  }
                ]
              }
            ]
          },
          {
            type: "card",
            className: "overflow-hidden",
            children: [
              {
                type: "div",
                className: "aspect-square bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900 dark:to-purple-800 flex items-center justify-center",
                children: [
                  {
                    type: "icon",
                    icon: "Laptop",
                    className: "h-20 w-20 text-purple-600 dark:text-purple-400"
                  }
                ]
              },
              {
                type: "div",
                className: "p-4 space-y-3",
                children: [
                  {
                    type: "div",
                    className: "flex items-start justify-between",
                    children: [
                      {
                        type: "div",
                        children: [
                          {
                            type: "text",
                            content: "MacBook Pro 16\"",
                            className: "font-semibold text-lg"
                          },
                          {
                            type: "text",
                            content: "M3 Max, 36GB RAM",
                            className: "text-sm text-muted-foreground"
                          }
                        ]
                      },
                      {
                        type: "badge",
                        label: "Hot",
                        variant: "destructive"
                      }
                    ]
                  },
                  {
                    type: "div",
                    className: "flex items-center gap-2",
                    children: [
                      {
                        type: "text",
                        content: "$2,499",
                        className: "text-2xl font-bold"
                      }
                    ]
                  },
                  {
                    type: "div",
                    className: "flex items-center gap-1",
                    children: [
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "text",
                        content: "(256 reviews)",
                        className: "text-sm text-muted-foreground ml-1"
                      }
                    ]
                  },
                  {
                    type: "button",
                    variant: "default",
                    label: "Add to Cart",
                    className: "w-full"
                  }
                ]
              }
            ]
          },
          {
            type: "card",
            className: "overflow-hidden",
            children: [
              {
                type: "div",
                className: "aspect-square bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900 dark:to-green-800 flex items-center justify-center",
                children: [
                  {
                    type: "icon",
                    icon: "Headphones",
                    className: "h-20 w-20 text-green-600 dark:text-green-400"
                  }
                ]
              },
              {
                type: "div",
                className: "p-4 space-y-3",
                children: [
                  {
                    type: "div",
                    className: "flex items-start justify-between",
                    children: [
                      {
                        type: "div",
                        children: [
                          {
                            type: "text",
                            content: "AirPods Pro",
                            className: "font-semibold text-lg"
                          },
                          {
                            type: "text",
                            content: "Active noise cancellation",
                            className: "text-sm text-muted-foreground"
                          }
                        ]
                      }
                    ]
                  },
                  {
                    type: "div",
                    className: "flex items-center gap-2",
                    children: [
                      {
                        type: "text",
                        content: "$249",
                        className: "text-2xl font-bold"
                      },
                      {
                        type: "text",
                        content: "$279",
                        className: "text-sm text-muted-foreground line-through"
                      }
                    ]
                  },
                  {
                    type: "div",
                    className: "flex items-center gap-1",
                    children: [
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "icon",
                        icon: "Star",
                        className: "h-4 w-4 fill-yellow-400 text-yellow-400"
                      },
                      {
                        type: "text",
                        content: "(89 reviews)",
                        className: "text-sm text-muted-foreground ml-1"
                      }
                    ]
                  },
                  {
                    type: "button",
                    variant: "default",
                    label: "Add to Cart",
                    className: "w-full"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
} satisfies Record<string, SchemaNode>;

type ViewMode = 'desktop' | 'tablet' | 'mobile';

const VIEW_MODES = {
  desktop: { width: '100%', label: 'Desktop', icon: Monitor },
  tablet: { width: '768px', label: 'Tablet', icon: Tablet },
  mobile: { width: '375px', label: 'Mobile', icon: Smartphone },
} as const;

export default function PlaygroundPage() {
  const [schema, setSchema] = useState<SchemaNode>(DEFAULT_SCHEMA);
  const [editorValue, setEditorValue] = useState(JSON.stringify(DEFAULT_SCHEMA, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [selectedExample, setSelectedExample] = useState<keyof typeof EXAMPLE_SCHEMAS>('basic');
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'light'>('vs-dark');
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('desktop');

  // Load collapsed state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedState = localStorage.getItem('playground-editor-collapsed');
      if (savedState) {
        setIsEditorCollapsed(savedState === 'true');
      }
    }
  }, []);

  // Save collapsed state to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('playground-editor-collapsed', String(isEditorCollapsed));
    }
  }, [isEditorCollapsed]);

  // Detect system theme
  React.useEffect(() => {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setEditorTheme(darkModeQuery.matches ? 'vs-dark' : 'light');
    
    const handleChange = (e: MediaQueryListEvent) => {
      setEditorTheme(e.matches ? 'vs-dark' : 'light');
    };
    
    darkModeQuery.addEventListener('change', handleChange);
    return () => darkModeQuery.removeEventListener('change', handleChange);
  }, []);

  const handleEditorChange = (value: string | undefined) => {
    if (!value) return;
    
    setEditorValue(value);
    
    try {
      const parsed = JSON.parse(value);
      setSchema(parsed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const loadExample = (exampleKey: keyof typeof EXAMPLE_SCHEMAS) => {
    const exampleSchema = EXAMPLE_SCHEMAS[exampleKey];
    setSelectedExample(exampleKey);
    setSchema(exampleSchema);
    setEditorValue(JSON.stringify(exampleSchema, null, 2));
    setError(null);
  };

  return (
    <ObjectUIProvider>
      <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        {/* Header */}
        <div className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                    ObjectUI Playground
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                    Edit JSON schema and see live preview
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Examples:</span>
                <div className="flex gap-2">
                  {(Object.keys(EXAMPLE_SCHEMAS) as Array<keyof typeof EXAMPLE_SCHEMAS>).map((key) => {
                    const labels: Record<keyof typeof EXAMPLE_SCHEMAS, string> = {
                      basic: 'Basic',
                      form: 'Form',
                      dashboard: 'Dashboard',
                      dataTable: 'Data Table',
                      ecommerce: 'E-commerce'
                    };
                    return (
                      <button type="button"
                        key={key}
                        onClick={() => loadExample(key)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                          selectedExample === key
                            ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md shadow-blue-500/30 scale-105'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:shadow'
                        }`}
                      >
                        {labels[key]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor Panel */}
          <div 
            className={`border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900 transition-all duration-300 ease-in-out ${
              isEditorCollapsed ? 'w-0' : 'w-1/2'
            }`}
            style={{ overflow: isEditorCollapsed ? 'hidden' : 'visible' }}
          >
            <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">JSON Schema</h2>
              {error && (
                <div className="flex-1 mx-4 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 max-w-md truncate">
                  {error}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <Editor
                height="100%"
                defaultLanguage="json"
                value={editorValue}
                onChange={handleEditorChange}
                theme={editorTheme}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                  padding: { top: 16, bottom: 16 },
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                }}
              />
            </div>
          </div>

          {/* Collapse/Expand Button */}
          <button type="button"
            onClick={() => setIsEditorCollapsed(!isEditorCollapsed)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-r-lg p-2 shadow-lg hover:shadow-xl hover:bg-slate-50 dark:hover:bg-slate-700 group transition-all duration-300"
            style={{ 
              left: isEditorCollapsed ? '0' : 'calc(50% - 16px)',
            }}
            aria-label={isEditorCollapsed ? 'Expand editor' : 'Collapse editor'}
          >
            {isEditorCollapsed ? (
              <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-100" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-100" />
            )}
          </button>

          {/* Preview Panel */}
          <div className={`flex flex-col bg-slate-50 dark:bg-slate-900 transition-all duration-300 ${
            isEditorCollapsed ? 'w-full' : 'w-1/2'
          }`}>
            <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Live Preview</h2>
              <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700 shadow-sm">
                {(Object.keys(VIEW_MODES) as ViewMode[]).map((mode) => {
                  const ModeIcon = VIEW_MODES[mode].icon;
                  return (
                    <button type="button"
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                        viewMode === mode
                          ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      aria-label={`Switch to ${VIEW_MODES[mode].label} view`}
                    >
                      <ModeIcon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{VIEW_MODES[mode].label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6 flex justify-center">
              {error ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3 bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700">
                    <div className="text-5xl">⚠️</div>
                    <div className="text-slate-600 dark:text-slate-400 font-medium">
                      Fix the JSON syntax to see preview
                    </div>
                  </div>
                </div>
              ) : (
                <div 
                  className="transition-all duration-300 ease-in-out"
                  style={{ 
                    width: VIEW_MODES[viewMode].width,
                    maxWidth: '100%',
                  }}
                >
                  <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden ${
                    viewMode === 'mobile' ? 'min-h-[667px]' : viewMode === 'tablet' ? 'min-h-[600px]' : ''
                  }`}>
                    <div className="p-6">
                      <SchemaRenderer schema={toRenderableSchema(schema)} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ObjectUIProvider>
  );
}
