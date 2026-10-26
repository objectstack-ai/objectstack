# Component Composition Rules

> **Critical:** Follow Shadcn composition patterns strictly for consistency and accessibility.

## Rule: Use Full Card Composition

**✅ CORRECT:**
```typescript
<Card>
  <CardHeader>
    <CardTitle>Customer Summary</CardTitle>
    <CardDescription>Active users this month</CardDescription>
  </CardHeader>
  <CardContent>
    {/* main content */}
  </CardContent>
  <CardFooter>
    <Button>View Details</Button>
  </CardFooter>
</Card>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Don't dump everything in CardContent
<Card>
  <CardContent>
    <h2>Customer Summary</h2>
    <p>Active users this month</p>
    {/* content */}
    <button>View Details</button>
  </CardContent>
</Card>
```

## Rule: Overlays Need Accessible Titles

Dialog, Sheet, and Drawer **always need a Title** for accessibility.

**✅ CORRECT:**
```typescript
<Dialog>
  <DialogContent>
    <DialogTitle>Confirm Delete</DialogTitle>
    {/* content */}
  </DialogContent>
</Dialog>

// If visually hidden:
<DialogTitle className="sr-only">Settings</DialogTitle>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Missing title - accessibility violation
<Dialog>
  <DialogContent>
    <p>Are you sure?</p>
  </DialogContent>
</Dialog>
```

## Rule: Items Inside Their Group

**✅ CORRECT:**
```typescript
<Select>
  <SelectTrigger />
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>

<DropdownMenu>
  <DropdownMenuTrigger />
  <DropdownMenuContent>
    <DropdownMenuGroup>
      <DropdownMenuItem>Profile</DropdownMenuItem>
      <DropdownMenuItem>Settings</DropdownMenuItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Items directly in Content without Group
<SelectContent>
  <SelectItem value="apple">Apple</SelectItem>
</SelectContent>
```

## Rule: TabsTrigger Must Be Inside TabsList

**✅ CORRECT:**
```typescript
<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">...</TabsContent>
  <TabsContent value="password">...</TabsContent>
</Tabs>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Triggers directly in Tabs
<Tabs>
  <TabsTrigger value="account">Account</TabsTrigger>
  <TabsContent value="account">...</TabsContent>
</Tabs>
```

## Rule: Avatar Always Needs Fallback

**✅ CORRECT:**
```typescript
<Avatar>
  <AvatarImage src={user.avatar} alt={user.name} />
  <AvatarFallback>{user.initials}</AvatarFallback>
</Avatar>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Missing fallback - shows nothing if image fails
<Avatar>
  <AvatarImage src={user.avatar} />
</Avatar>
```

## Rule: Use Existing Components, Not Custom Markup

**Callouts use Alert:**
```typescript
// ✅ Correct
<Alert variant="destructive">
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>

// ❌ Wrong
<div className="border-l-4 border-red-500 p-4">
  <strong>Error</strong>
  <p>Something went wrong.</p>
</div>
```

**Empty states use Empty:** it composes like `Card`, it is not a props bag —
`Empty` and its parts each take only `className` + children.
```typescript
// ✅ Correct
<Empty>
  <EmptyMedia><InboxIcon /></EmptyMedia>
  <EmptyTitle>No results found</EmptyTitle>
  <EmptyDescription>Try adjusting your search</EmptyDescription>
</Empty>

// ❌ Wrong — `icon` / `title` / `description` are not props; they land on the
//    underlying <div> as unknown attributes and nothing renders.
<Empty icon={<InboxIcon />} title="No results found" />
```
Parts: `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`,
`EmptyContent`, `EmptyValue` (`@object-ui/components`).

**Use Separator instead of hr:**
```typescript
// ✅ Correct
<Separator />

// ❌ Wrong
<hr />
<div className="border-t" />
```

**Use Skeleton for loading:**
```typescript
// ✅ Correct
<Skeleton className="h-64 w-full" />

// ❌ Wrong
<div className="animate-pulse bg-gray-200 h-64 w-full" />
```

**Use Badge instead of styled spans:**
```typescript
// ✅ Correct
<Badge variant="secondary">New</Badge>

// ❌ Wrong
<span className="px-2 py-1 bg-gray-200 rounded">New</span>
```

## Rule: Toast via Sonner

**✅ CORRECT:**
<!-- os:check -->
```typescript
import { toast } from 'sonner';

toast.success('Item saved');
toast.error('Failed to save');
toast.info('Processing...');
```

**❌ FORBIDDEN:**
```typescript
// ❌ Don't build custom toast systems
showNotification({ type: 'success', message: 'Saved' });
```

## Rule: Button Loading State

**✅ CORRECT:**
```typescript
<Button disabled={isLoading}>
  {isLoading && <Spinner />}
  {isLoading ? 'Saving...' : 'Save'}
</Button>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Button has no isPending/isLoading prop
<Button isPending={isLoading}>Save</Button>
```

## Rule: Icons in Buttons Are Children — No Sizing, No Spacing, No `icon` Prop

Put the icon where you want it in the children; leading or trailing is child
order. `buttonVariants`' base string already carries `gap-2` and
`[&_svg]:size-4 [&_svg]:shrink-0`, so the spacing and the sizing are done.

**✅ CORRECT:**
```typescript
import { SearchIcon, ChevronRightIcon } from 'lucide-react';

<Button><SearchIcon />Search</Button>
<Button>Save<ChevronRightIcon /></Button>
```

**❌ FORBIDDEN:**
```typescript
// ❌ Manual sizing or spacing classes on the icon — the base string does both
<Button><SearchIcon className="mr-2 size-4" />Search</Button>

// ❌ There is no `icon` prop. `ButtonProps` is ButtonHTMLAttributes +
//    variant/size + `asChild`, so this reaches the DOM as an unknown
//    attribute and renders nothing. (`size="icon"` is the square-button
//    SIZE variant — a different key with a confusingly similar name.)
<Button icon={CheckIcon}>Save</Button>
```

## Rule: Registry-Based Component Resolution

For schema-driven rendering, use ComponentRegistry, not switch/case:

**✅ CORRECT:**
```typescript
const Component = ComponentRegistry.get(schema.type);
return <Component schema={schema} />;
```

**❌ FORBIDDEN:**
```typescript
// ❌ Don't use switch statements
switch (schema.type) {
  case 'button': return <Button {...schema.props} />;
  case 'card': return <Card {...schema.props} />;
  // ...
}
```
