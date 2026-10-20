{
  "subject": {"commonName": {{ toJson .Insecure.User.ip }}},
  "sans": [{"type": "ip", "value": {{ toJson .Insecure.User.ip }}}],
  "keyUsage": ["digitalSignature"],
  "extKeyUsage": ["serverAuth"],
  "basicConstraints": {"isCA": false}
}
