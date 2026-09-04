One module per lantern. Each exports a create<Name>({ seed, scale }) returning
{ group, update(time, dt), dispose() }, the same shape every other prop uses.
